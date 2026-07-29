import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
  UserRole,
} from '@prisma/client';

import { ProofRepository } from '../repositories/proof.repository';

import { OrdersService } from '../../orders/services/orders.service';
import { RealtimeService } from '../../realtime/services/realtime.service';
import { AuditService } from '../../audit/services/audit.service';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { PasswordService } from '../../auth/services/password.service';

import { AuthenticatedUser } from '../../../shared/authorization/order-access.util';

const OTP_EXPIRY_MINUTES = 10;
const MAX_ATTEMPTS = 5;

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
  ) {}

  async generatePickupOtp(orderId: string, user: AuthenticatedUser) {
    return this.generate(orderId, DeliveryProofType.PICKUP, user);
  }

  async generateDeliveryOtp(orderId: string, user: AuthenticatedUser) {
    return this.generate(orderId, DeliveryProofType.DELIVERY, user);
  }

  async verifyPickupOtp(
    orderId: string,
    code: string,
    user: AuthenticatedUser,
  ) {
    return this.verify(orderId, DeliveryProofType.PICKUP, code, user);
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

    const otp = await this.proofRepository.upsertOtp(
      orderId,
      type,
      otpHash,
      expiresAt,
      MAX_ATTEMPTS,
    );

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

  private async verify(
    orderId: string,
    type: DeliveryProofType,
    code: string,
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
      const nextAttempts = otp.attempts + 1;
      const exceeded = nextAttempts >= otp.maxAttempts;

      const updated = await this.proofRepository.incrementAttempts(
        otp.id,
        exceeded ? DeliveryProofOtpStatus.EXCEEDED : undefined,
      );

      await this.auditService.log(
        user.userId,
        'DeliveryProofOtp',
        otp.id,
        AuditAction.REJECT,
        undefined,
        { orderId, type, attempts: updated.attempts, exceeded },
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

    await this.proofRepository.markVerified(otp.id);

    await this.auditService.log(
      user.userId,
      'DeliveryProofOtp',
      otp.id,
      AuditAction.APPROVE,
      undefined,
      { orderId, type },
    );

    const updatedOrder = await this.ordersService.updateOrderStatus(
      orderId,
      { status: TARGET_ORDER_STATUS[type] },
      user,
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
