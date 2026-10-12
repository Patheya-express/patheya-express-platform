import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { randomInt } from 'crypto';

import {
  AuditAction,
  DeliveryProofOtpStatus,
  DeliveryProofType,
  NotificationType,
  OrderStatus,
  Prisma,
  UserRole,
} from '@prisma/client';

import { ProofRepository } from '../repositories/proof.repository';

import { OrdersService } from '../../orders/services/orders.service';
import { RealtimeService } from '../../realtime/services/realtime.service';
import { AuditService } from '../../audit/services/audit.service';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { PasswordService } from '../../auth/services/password.service';
import { StorageService } from '../../storage/services/storage.service';
import { haversineDistanceKm } from '../../restaurants/utils/geo.util';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import type { UploadFile } from '../../../shared/types/upload-file.type';

import {
  AuthenticatedUser,
  canAccessOrder,
} from '../../../shared/authorization/order-access.util';

/** Folder the pickup-parcel photo is uploaded under — mirrors the `<feature>/<subfolder>`
 *  convention StorageService's other callers use (e.g. 'delivery-partners/documents'). */
const PICKUP_PHOTO_FOLDER = 'delivery-proof/pickup';

const OTP_EXPIRY_MINUTES = 10;
const MAX_ATTEMPTS = 5;

/**
 * 2026-10-12 OTP hardening. No product rule existed for either value; these are the
 * recommended defaults (documented in the Phase 2 report):
 *  - 60 s between codes — long enough to stop accidental double taps and code flooding, short
 *    enough that a customer who missed the notification gets a new code quickly;
 *  - 5 codes per order — with MAX_ATTEMPTS guesses each, at most 25 guesses against a 1-in-a-
 *    million code (~0.0025%) for the whole delivery. Previously regeneration was unlimited and
 *    each one reset the attempt counter, so the 5-attempt cap bounded nothing overall.
 * Enforced for delivery partners only; admins keep their support-override path (they can also
 * force-complete an order) but can never overwrite an already-verified code.
 */
const OTP_RESEND_COOLDOWN_SECONDS = 60;
const OTP_MAX_ISSUES_PER_ORDER = 5;

/**
 * 2026-09-16 business-workflow revision — the single source of truth for the restaurant-arrival
 * geofence radius (business requirement: rider must be within ~100m of the pickup location
 * before "I've Arrived" is accepted). Centralized here rather than scattered across the
 * controller/DTO/frontend as a bare literal.
 */
const ARRIVAL_RADIUS_METERS = 100;

/** The order status each proof type must find the order in before an OTP can be generated for it — reuses the existing order-status state machine as the guard instead of tracking a separate "already verified" flag. */
const REQUIRED_ORDER_STATUS: Record<DeliveryProofType, OrderStatus> = {
  [DeliveryProofType.PICKUP]: OrderStatus.READY_FOR_PICKUP,
  [DeliveryProofType.DELIVERY]: OrderStatus.OUT_FOR_DELIVERY,
};

/** The order status a successful verification of each proof type advances the order to. */
const TARGET_ORDER_STATUS: Record<DeliveryProofType, OrderStatus> = {
  [DeliveryProofType.PICKUP]: OrderStatus.OUT_FOR_DELIVERY,
  [DeliveryProofType.DELIVERY]: OrderStatus.DELIVERED,
};

const OTP_GENERATED_NOTIFICATION: Record<DeliveryProofType, NotificationType> =
  {
    [DeliveryProofType.PICKUP]: NotificationType.PICKUP_OTP_GENERATED,
    [DeliveryProofType.DELIVERY]: NotificationType.DELIVERY_OTP_GENERATED,
  };

const OTP_VERIFIED_NOTIFICATION: Record<DeliveryProofType, NotificationType> = {
  [DeliveryProofType.PICKUP]: NotificationType.PICKUP_VERIFIED,
  [DeliveryProofType.DELIVERY]: NotificationType.DELIVERY_VERIFIED,
};

const REALTIME_VERIFIED_EVENT: Record<DeliveryProofType, string> = {
  [DeliveryProofType.PICKUP]: 'pickup.verified',
  [DeliveryProofType.DELIVERY]: 'delivery.verified',
};

/**
 * Delivery Proof & Trust (Sprint 4.1). Generates and verifies the 6-digit OTPs that gate the
 * OUT_FOR_DELIVERY and DELIVERED transitions — before this, any assigned delivery partner could
 * flip those statuses with no customer-side confirmation at all. Order-status transitions
 * themselves are still delegated to OrdersService.updateOrderStatus (the single source of truth
 * for that state machine, already publishing order.status.changed + OrderStatusHistory) — this
 * service only adds the proof step in front of it.
 */
@Injectable()
export class ProofService {
  constructor(
    private readonly proofRepository: ProofRepository,
    private readonly ordersService: OrdersService,
    private readonly realtimeService: RealtimeService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
    private readonly passwordService: PasswordService,
    private readonly storageService: StorageService,
    private readonly prisma: PrismaService,
  ) {}

  // 2026-10-11 pickup revision — there is no pickup OTP any more (it was sent to the customer, who
  // isn't at the restaurant). Pickup is gated by the parcel photo alone; see
  // OrdersService.REQUIRED_PROOF_TYPE_FOR_STATUS. Only the delivery OTP remains.
  async generateDeliveryOtp(orderId: string, user: AuthenticatedUser) {
    return this.generate(orderId, DeliveryProofType.DELIVERY, user);
  }

  async verifyDeliveryOtp(
    orderId: string,
    code: string,
    user: AuthenticatedUser,
  ) {
    return this.verify(orderId, DeliveryProofType.DELIVERY, code, user);
  }

  async getProofStatus(
    orderId: string,
    type: DeliveryProofType,
    user: AuthenticatedUser,
  ) {
    const order = await this.ordersService.getOrderOwnership(orderId);

    this.assertAssignedPartner(order, user);

    const otp = await this.proofRepository.findOtp(orderId, type);

    if (!otp) {
      throw new NotFoundException(
        `No ${type.toLowerCase()} OTP has been generated for this order`,
      );
    }

    return this.toStatusResponse(otp, order.status);
  }

  /**
   * Mandatory pickup-parcel evidence (business requirement: pickup photo before pickup can
   * complete). Write-once: a second call for the same order is rejected rather than replacing the
   * evidence (see ProofRepository.createPhoto's doc comment) — a rider who wants to retake the
   * photo does so client-side, before submitting. This row is what
   * OrdersService.assertPhotoVerifiedForStatus checks before allowing OUT_FOR_DELIVERY, so it is
   * the authoritative pickup-completion gate, not merely advisory. The photo is reference-only:
   * nobody (customer included) has to approve it.
   *
   * 2026-10-11 pickup revision — the rider must have marked arrival (the backend-validated 100m
   * geofence, markRestaurantArrival) before the photo is accepted, so the server enforces the
   * full arrive → photo → pickup order rather than relying on the app's button sequence. Admins
   * keep the same support-override bypass assertAssignedPartner already gives them.
   */
  async uploadPickupPhoto(
    orderId: string,
    file: UploadFile,
    user: AuthenticatedUser,
  ) {
    const order = await this.ordersService.getOrderOwnership(orderId);

    this.assertAssignedPartner(order, user);

    if (order.status !== REQUIRED_ORDER_STATUS[DeliveryProofType.PICKUP]) {
      throw new BadRequestException(
        `A pickup photo can only be uploaded while the order is ${REQUIRED_ORDER_STATUS[DeliveryProofType.PICKUP]} (currently ${order.status})`,
      );
    }

    if (user.role === UserRole.DELIVERY_PARTNER) {
      const assignment =
        await this.proofRepository.findActiveAssignmentForOrder(
          orderId,
          user.userId,
        );

      if (!assignment) {
        throw new ForbiddenException(
          'No active assignment for this order belongs to you',
        );
      }

      if (!assignment.arrivedAtRestaurantAt) {
        throw new BadRequestException(
          'Mark your arrival at the restaurant before uploading the parcel photo',
        );
      }
    }

    const existing = await this.proofRepository.findPhoto(
      orderId,
      DeliveryProofType.PICKUP,
    );

    if (existing) {
      throw new ConflictException(
        'A pickup photo has already been submitted for this order',
      );
    }

    const uploadResult = await this.storageService.uploadWithMetadata(
      file,
      PICKUP_PHOTO_FOLDER,
    );

    let photo;

    try {
      photo = await this.proofRepository.createPhoto({
        orderId,
        type: DeliveryProofType.PICKUP,
        storageUrl: uploadResult.secureUrl ?? uploadResult.url,
        fileName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        uploadedById: user.userId,
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException(
          'A pickup photo has already been submitted for this order',
        );
      }

      throw error;
    }

    await this.auditService.log(
      user.userId,
      'DeliveryProofPhoto',
      photo.id,
      AuditAction.CREATE,
      undefined,
      { orderId, type: DeliveryProofType.PICKUP },
    );

    this.realtimeService.emitToOrder(orderId, 'pickup.photo.uploaded', {
      orderId,
      type: DeliveryProofType.PICKUP,
      uploadedAt: photo.createdAt,
    });

    return this.toPhotoResponse(photo);
  }

  /** Readable by the order's customer, its assigned delivery partner, its restaurant staff, or an
   *  admin — the same access rule Socket.IO room joins already use (canAccessOrder). */
  async getPickupPhoto(orderId: string, user: AuthenticatedUser) {
    const order = await this.ordersService.getOrderOwnership(orderId);

    const allowed = await canAccessOrder(this.prisma, order, user);

    if (!allowed) {
      throw new ForbiddenException('You do not have access to this order');
    }

    const photo = await this.proofRepository.findPhoto(
      orderId,
      DeliveryProofType.PICKUP,
    );

    if (!photo) {
      throw new NotFoundException(
        'No pickup photo has been uploaded for this order',
      );
    }

    return this.toPhotoResponse(photo);
  }

  /**
   * 2026-09-16 business-workflow revision — the rider-facing "I've Arrived" action. The backend
   * is authoritative: the rider's client-reported coordinates (the same trust model
   * TrackingService.updateLocation already uses — this codebase has no independent
   * location-attestation mechanism to layer on top) are validated server-side against the
   * order's actual pickup coordinates (OrdersService.getPickupLocation) before the arrival is
   * accepted, so a client cannot simply claim `arrived: true`. Idempotent: a rider who taps this
   * twice (or whose request retries) gets the same success response back rather than an error —
   * see ProofRepository.markArrival's conditional-update doc comment.
   */
  async markRestaurantArrival(
    orderId: string,
    latitude: number,
    longitude: number,
    user: AuthenticatedUser,
  ) {
    const order = await this.ordersService.getOrderOwnership(orderId);

    this.assertAssignedPartner(order, user);

    if (order.status !== OrderStatus.READY_FOR_PICKUP) {
      throw new BadRequestException(
        `Restaurant arrival can only be marked while the order is ${OrderStatus.READY_FOR_PICKUP} (currently ${order.status})`,
      );
    }

    const assignment = await this.proofRepository.findActiveAssignmentForOrder(
      orderId,
      user.userId,
    );

    if (!assignment) {
      throw new ForbiddenException(
        'No active assignment for this order belongs to you',
      );
    }

    if (!assignment.arrivedAtRestaurantAt) {
      const pickupLocation =
        await this.ordersService.getPickupLocation(orderId);

      if (!pickupLocation) {
        throw new BadRequestException(
          'This order has no pickup location on record',
        );
      }

      const distanceMeters =
        haversineDistanceKm(
          latitude,
          longitude,
          pickupLocation.latitude,
          pickupLocation.longitude,
        ) * 1000;

      if (distanceMeters > ARRIVAL_RADIUS_METERS) {
        throw new BadRequestException(
          `You are ${Math.round(distanceMeters)}m from the restaurant — move within ${ARRIVAL_RADIUS_METERS}m to mark arrival`,
        );
      }
    }

    const updatedAssignment = await this.proofRepository.markArrival(
      assignment.id,
    );

    await this.auditService.log(
      user.userId,
      'DeliveryAssignment',
      updatedAssignment.id,
      AuditAction.UPDATE,
      undefined,
      {
        orderId,
        arrivedAtRestaurantAt: updatedAssignment.arrivedAtRestaurantAt,
      },
    );

    await this.notificationsService.createNotification(
      order.customerId,
      NotificationType.RIDER_ARRIVED_AT_RESTAURANT,
      'Delivery partner arrived',
      'Your delivery partner has arrived at the restaurant and will pick up your order shortly.',
      { referenceType: 'ORDER', referenceId: orderId },
    );

    this.realtimeService.emitToOrder(
      orderId,
      'delivery.arrived_at_restaurant',
      {
        orderId,
        arrivedAt: updatedAssignment.arrivedAtRestaurantAt,
      },
    );

    return {
      orderId,
      arrivedAtRestaurantAt: updatedAssignment.arrivedAtRestaurantAt,
    };
  }

  /** Lets the customer/restaurant/admin (or the rider themselves) check current arrival state —
   *  mirrors getProofStatus's shape/authorization for the same reason: resumable after refresh
   *  without relying on having caught the realtime event live. */
  async getArrivalStatus(orderId: string, user: AuthenticatedUser) {
    const order = await this.ordersService.getOrderOwnership(orderId);

    const allowed = await canAccessOrder(this.prisma, order, user);

    if (!allowed) {
      throw new ForbiddenException('You do not have access to this order');
    }

    const assignment = order.deliveryPartnerId
      ? await this.proofRepository.findAssignmentForOrder(
          orderId,
          order.deliveryPartnerId,
        )
      : null;

    return {
      orderId,
      arrivedAtRestaurantAt: assignment?.arrivedAtRestaurantAt ?? null,
    };
  }

  /** Generate also serves as regenerate — calling it again always overwrites the existing OTP and resets the attempt count. */
  private async generate(
    orderId: string,
    type: DeliveryProofType,
    user: AuthenticatedUser,
  ) {
    const order = await this.ordersService.getOrderOwnership(orderId);

    this.assertAssignedPartner(order, user);

    if (order.status !== REQUIRED_ORDER_STATUS[type]) {
      throw new BadRequestException(
        `A ${type.toLowerCase()} OTP can only be generated while the order is ${REQUIRED_ORDER_STATUS[type]} (currently ${order.status})`,
      );
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const otpHash = await this.passwordService.hashPassword(code);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60_000);

    const result = await this.proofRepository.issueOtp({
      orderId,
      type,
      otpHash,
      expiresAt,
      maxAttempts: MAX_ATTEMPTS,
      limits:
        user.role === UserRole.DELIVERY_PARTNER
          ? {
              cooldownMs: OTP_RESEND_COOLDOWN_SECONDS * 1000,
              maxGenerations: OTP_MAX_ISSUES_PER_ORDER,
            }
          : undefined,
    });

    if (!result.issued) {
      // Nothing was sent to the customer for a refused request.
      throw this.otpNotIssuedError(type, result.reason, result.existing);
    }

    const { otp } = result;

    await this.auditService.log(
      user.userId,
      'DeliveryProofOtp',
      otp.id,
      AuditAction.CREATE,
      undefined,
      { orderId, type, expiresAt },
    );

    await this.notificationsService.createNotification(
      order.customerId,
      OTP_GENERATED_NOTIFICATION[type],
      type === DeliveryProofType.PICKUP
        ? 'Pickup verification code'
        : 'Delivery verification code',
      `Your ${type.toLowerCase()} code is ${code}. Share this with your delivery partner to confirm ${type === DeliveryProofType.PICKUP ? 'pickup' : 'delivery'}.`,
      { referenceType: 'ORDER', referenceId: orderId, type },
    );

    return {
      orderId,
      type,
      expiresAt: otp.expiresAt,
      maxAttempts: otp.maxAttempts,
    };
  }

  /** Explains why no new code was issued. The existing code (if any) stays valid. */
  private otpNotIssuedError(
    type: DeliveryProofType,
    reason: 'verified' | 'limit' | 'cooldown',
    existing: { lastGeneratedAt: Date },
  ): HttpException {
    const label = type.toLowerCase();

    if (reason === 'verified') {
      return new ConflictException(`This ${label} has already been verified`);
    }

    if (reason === 'limit') {
      return new HttpException(
        `The maximum of ${OTP_MAX_ISSUES_PER_ORDER} ${label} codes has been sent for this order. Contact support to complete it.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const elapsedMs = Date.now() - existing.lastGeneratedAt.getTime();
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((OTP_RESEND_COOLDOWN_SECONDS * 1000 - elapsedMs) / 1000),
    );

    return new HttpException(
      `A ${label} code was already sent to the customer. You can request a new one in ${retryAfterSeconds} seconds.`,
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private async verify(
    orderId: string,
    type: DeliveryProofType,
    code: string,
    user: AuthenticatedUser,
  ) {
    const order = await this.ordersService.getOrderOwnership(orderId);

    this.assertAssignedPartner(order, user);

    // Fail fast on a cancelled/already-delivered order instead of consuming an attempt or marking
    // the OTP verified for a transition updateOrderStatus would then refuse.
    if (order.status !== REQUIRED_ORDER_STATUS[type]) {
      throw new BadRequestException(
        `A ${type.toLowerCase()} OTP can only be verified while the order is ${REQUIRED_ORDER_STATUS[type]} (currently ${order.status})`,
      );
    }

    const otp = await this.proofRepository.findOtp(orderId, type);

    if (!otp) {
      throw new NotFoundException(
        `No ${type.toLowerCase()} OTP has been generated for this order`,
      );
    }

    if (otp.status === DeliveryProofOtpStatus.VERIFIED) {
      throw new ConflictException(
        `This ${type.toLowerCase()} has already been verified`,
      );
    }

    if (otp.status === DeliveryProofOtpStatus.EXCEEDED) {
      throw new ForbiddenException(
        'Maximum verification attempts exceeded — regenerate the OTP to try again',
      );
    }

    if (
      otp.status === DeliveryProofOtpStatus.EXPIRED ||
      otp.expiresAt < new Date()
    ) {
      if (otp.status !== DeliveryProofOtpStatus.EXPIRED) {
        await this.proofRepository.markStatus(
          otp.id,
          DeliveryProofOtpStatus.EXPIRED,
        );
      }

      throw new BadRequestException(
        'This OTP has expired — regenerate the OTP to try again',
      );
    }

    const isMatch = await this.passwordService.comparePassword(
      code,
      otp.otpHash,
    );

    if (!isMatch) {
      // Atomic, cap-respecting increment — see ProofRepository.recordFailedAttempt. null means a
      // concurrent request already used the last attempt (or verified/regenerated the code).
      const updated = await this.proofRepository.recordFailedAttempt(
        otp.id,
        otp.maxAttempts,
      );
      const exceeded =
        !updated || updated.status === DeliveryProofOtpStatus.EXCEEDED;

      await this.auditService.log(
        user.userId,
        'DeliveryProofOtp',
        otp.id,
        AuditAction.REJECT,
        undefined,
        {
          orderId,
          type,
          attempts: updated?.attempts ?? otp.maxAttempts,
          exceeded,
        },
      );

      if (exceeded) {
        throw new ForbiddenException(
          'Maximum verification attempts exceeded — regenerate the OTP to try again',
        );
      }

      throw new BadRequestException(
        `Incorrect code — ${otp.maxAttempts - updated.attempts} attempt(s) remaining`,
      );
    }

    // Only one concurrent correct submission may claim the verification; the loser gets the same
    // "already verified" answer a sequential retry would.
    const claimed = await this.proofRepository.markVerifiedIfPending(otp.id);

    if (!claimed) {
      throw new ConflictException(
        `This ${type.toLowerCase()} has already been verified`,
      );
    }

    const updatedOrder = await this.ordersService
      .updateOrderStatus(orderId, { status: TARGET_ORDER_STATUS[type] }, user)
      .catch(async (error: unknown) => {
        // The order did not advance (e.g. cancelled between the status check above and here) —
        // release the OTP so it isn't left permanently "already verified" against that order.
        await this.proofRepository.revertVerification(otp.id);
        throw error;
      });

    await this.auditService.log(
      user.userId,
      'DeliveryProofOtp',
      otp.id,
      AuditAction.APPROVE,
      undefined,
      { orderId, type },
    );

    this.realtimeService.emitToOrder(orderId, REALTIME_VERIFIED_EVENT[type], {
      orderId,
      type,
      verifiedAt: new Date(),
    });

    await this.notificationsService.createNotification(
      user.userId,
      OTP_VERIFIED_NOTIFICATION[type],
      type === DeliveryProofType.PICKUP
        ? 'Pickup verified'
        : 'Delivery verified',
      type === DeliveryProofType.PICKUP
        ? 'Pickup confirmed. Navigate to the customer to complete delivery.'
        : 'Delivery confirmed. Great job!',
      { referenceType: 'ORDER', referenceId: orderId, type },
    );

    const finalOtp = await this.proofRepository.findOtp(orderId, type);

    return this.toStatusResponse(finalOtp!, updatedOrder.status);
  }

  /** Mirrors TrackingService.updateLocation's isAdmin/isAssignedPartner pattern — only the order's assigned delivery partner (or an admin, for support overrides) may generate/verify its proof OTPs. */
  private assertAssignedPartner(
    order: { deliveryPartnerId: string | null },
    user: AuthenticatedUser,
  ): void {
    const isAdmin =
      user.role === UserRole.ADMIN || user.role === UserRole.SUPER_ADMIN;
    const isAssignedPartner =
      user.role === UserRole.DELIVERY_PARTNER &&
      order.deliveryPartnerId === user.userId;

    if (!isAdmin && !isAssignedPartner) {
      throw new ForbiddenException(
        "Only the order's assigned delivery partner can manage its proof OTPs",
      );
    }
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  private toPhotoResponse(photo: {
    id: string;
    orderId: string;
    type: DeliveryProofType;
    storageUrl: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    uploadedById: string;
    createdAt: Date;
  }) {
    return {
      id: photo.id,
      orderId: photo.orderId,
      type: photo.type,
      storageUrl: photo.storageUrl,
      fileName: photo.fileName,
      mimeType: photo.mimeType,
      sizeBytes: photo.sizeBytes,
      uploadedById: photo.uploadedById,
      createdAt: photo.createdAt,
    };
  }

  private toStatusResponse(
    otp: {
      id: string;
      status: DeliveryProofOtpStatus;
      attempts: number;
      maxAttempts: number;
      expiresAt: Date;
      verifiedAt: Date | null;
      orderId: string;
      type: DeliveryProofType;
    },
    orderStatus: OrderStatus,
  ) {
    return {
      orderId: otp.orderId,
      type: otp.type,
      status: otp.status,
      attempts: otp.attempts,
      maxAttempts: otp.maxAttempts,
      attemptsRemaining: Math.max(0, otp.maxAttempts - otp.attempts),
      expiresAt: otp.expiresAt,
      verifiedAt: otp.verifiedAt ?? undefined,
      orderStatus,
    };
  }
}
