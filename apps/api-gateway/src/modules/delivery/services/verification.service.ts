import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  AuditAction,
  DeliveryVerificationStage,
  NotificationType,
} from '@prisma/client';

import { DeliveryRepository } from '../repositories/delivery.repository';
import { VerificationRepository } from '../repositories/verification.repository';

import { AuditService } from '../../audit/services/audit.service';
import { EventBusService } from '../../../core/events/event-bus.service';
import { NotificationsService } from '../../notifications/services/notifications.service';

/**
 * Linear forward path. REJECTED/SUSPENDED are side-branches reachable from any non-terminal
 * stage (reject) or from APPROVED (suspend) rather than positions in this array. Deliberately
 * simpler than RestaurantVerificationStage — no granular per-category sub-stages, since delivery
 * documents are reviewed atomically per-document via the Documents API.
 */
const STAGE_ORDER: DeliveryVerificationStage[] = [
  DeliveryVerificationStage.DRAFT,
  DeliveryVerificationStage.SUBMITTED,
  DeliveryVerificationStage.UNDER_REVIEW,
  DeliveryVerificationStage.APPROVED,
];

/** Every stage reject() may legally act on — matches the pre-existing JS check this replaces
 *  exactly: `stage === REJECTED || stage === APPROVED` were the only two excluded. */
const REJECTABLE_STAGES = STAGE_ORDER.filter(
  (stage) => stage !== DeliveryVerificationStage.APPROVED,
);

/**
 * The delivery-partner analog of RestaurantVerification's VerificationService. Reaching APPROVED
 * (or leaving it via reject/suspend) is what drives DeliveryPartner.isVerified — the single
 * boolean Dispatch.findAvailablePartners/DeliveryService.goAvailable/PresenceController actually
 * gate on. Every transition writes both a generic AuditLog entry and a dedicated
 * VerificationHistory row (for the partner-facing "Verification Timeline").
 */
@Injectable()
export class VerificationService {
  constructor(
    private readonly deliveryRepository: DeliveryRepository,
    private readonly verificationRepository: VerificationRepository,
    private readonly auditService: AuditService,
    private readonly eventBus: EventBusService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private async requirePartner(userId: string) {
    const partner = await this.deliveryRepository.findPartnerByUserId(userId);

    if (!partner) {
      throw new NotFoundException('Delivery partner not found');
    }

    return partner;
  }

  private async requirePartnerById(deliveryPartnerId: string) {
    const partner = await this.deliveryRepository.findById(deliveryPartnerId);

    if (!partner) {
      throw new NotFoundException('Delivery partner not found');
    }

    return partner;
  }

  async getStatus(userId: string) {
    const partner = await this.requirePartner(userId);

    return this.verificationRepository.findOrCreate(partner.id);
  }

  async getHistory(userId: string) {
    const partner = await this.requirePartner(userId);

    return this.verificationRepository.findHistory(partner.id);
  }

  async submit(userId: string) {
    const partner = await this.requirePartner(userId);

    const current = await this.verificationRepository.findOrCreate(partner.id);

    if (current.stage !== DeliveryVerificationStage.DRAFT) {
      throw new BadRequestException(
        'Only a DRAFT verification can be submitted',
      );
    }

    const claim = await this.verificationRepository.claimStageTransition({
      deliveryPartnerId: partner.id,

      allowedFromStages: [DeliveryVerificationStage.DRAFT],

      toStage: DeliveryVerificationStage.SUBMITTED,

      extra: { submittedAt: new Date() },

      history: { fromStage: current.stage, decidedById: userId },
    });

    if (claim.count === 0) {
      throw new ConflictException(
        'This verification is no longer DRAFT — it was already submitted',
      );
    }

    await this.auditService.log(
      userId,
      'DeliveryVerification',
      partner.id,
      AuditAction.STATUS_CHANGE,
      { stage: 'DRAFT' },
      { stage: 'SUBMITTED' },
    );

    await this.eventBus.publish('delivery.submitted', {
      deliveryPartnerId: partner.id,
    });

    await this.notificationsService.createNotification(
      userId,
      NotificationType.DELIVERY_PARTNER_VERIFICATION_SUBMITTED,
      'Application submitted',
      'Your delivery partner application has been submitted for review.',
    );

    return this.verificationRepository.findOrCreate(partner.id);
  }

  /** Admin-only — moves to the next stage in STAGE_ORDER. */
  async advance(deliveryPartnerId: string, adminUserId: string) {
    const current =
      await this.verificationRepository.findOrCreate(deliveryPartnerId);

    const currentIndex = STAGE_ORDER.indexOf(current.stage);

    if (currentIndex === -1 || currentIndex === STAGE_ORDER.length - 1) {
      throw new BadRequestException(
        `Verification at stage ${current.stage} cannot be advanced further`,
      );
    }

    const nextStage = STAGE_ORDER[currentIndex + 1];

    const extra =
      nextStage === DeliveryVerificationStage.APPROVED
        ? { decidedAt: new Date() }
        : {};

    // The authoritative check: `current.stage` above is a snapshot, not proof the row is still
    // there right now. The claim below — which also atomically flips isVerified when advancing to
    // APPROVED, in the SAME transaction — is what actually enforces "exactly one winner" and what
    // makes verification completion and activation atomic (Phase 4/5).
    const claim = await this.verificationRepository.claimStageTransition({
      deliveryPartnerId,

      allowedFromStages: [current.stage],

      toStage: nextStage,

      extra,

      isVerifiedUpdate:
        nextStage === DeliveryVerificationStage.APPROVED ? true : undefined,

      history: { fromStage: current.stage, decidedById: adminUserId },
    });

    if (claim.count === 0) {
      throw new ConflictException(
        `This verification is no longer at stage ${current.stage} — a concurrent admin action already changed it`,
      );
    }

    await this.auditService.log(
      adminUserId,
      'DeliveryVerification',
      deliveryPartnerId,
      AuditAction.STATUS_CHANGE,
      { stage: current.stage },
      { stage: nextStage },
    );

    if (nextStage === DeliveryVerificationStage.APPROVED) {
      await this.eventBus.publish('delivery.approved', { deliveryPartnerId });

      const partner = await this.requirePartnerById(deliveryPartnerId);

      await this.notificationsService.createNotification(
        partner.userId,
        NotificationType.DELIVERY_PARTNER_VERIFICATION_APPROVED,
        'Application approved',
        'Your delivery partner application has been approved. You can now go online and receive orders.',
      );
    }

    return this.verificationRepository.findOrCreate(deliveryPartnerId);
  }

  /** Admin-only — rejects from any non-terminal stage. */
  async reject(deliveryPartnerId: string, reason: string, adminUserId: string) {
    const current =
      await this.verificationRepository.findOrCreate(deliveryPartnerId);

    if (
      current.stage === DeliveryVerificationStage.REJECTED ||
      current.stage === DeliveryVerificationStage.APPROVED
    ) {
      throw new BadRequestException(
        `Verification at stage ${current.stage} cannot be rejected`,
      );
    }

    const claim = await this.verificationRepository.claimStageTransition({
      deliveryPartnerId,

      allowedFromStages: REJECTABLE_STAGES,

      toStage: DeliveryVerificationStage.REJECTED,

      extra: { decidedAt: new Date(), rejectedReason: reason },

      isVerifiedUpdate: false,

      history: { fromStage: current.stage, reason, decidedById: adminUserId },
    });

    if (claim.count === 0) {
      throw new ConflictException(
        'This verification can no longer be rejected — a concurrent admin action already approved or rejected it',
      );
    }

    await this.auditService.log(
      adminUserId,
      'DeliveryVerification',
      deliveryPartnerId,
      AuditAction.REJECT,
      { stage: current.stage },
      { stage: 'REJECTED', reason },
    );

    await this.eventBus.publish('delivery.rejected', {
      deliveryPartnerId,
      reason,
    });

    const partner = await this.requirePartnerById(deliveryPartnerId);

    await this.notificationsService.createNotification(
      partner.userId,
      NotificationType.DELIVERY_PARTNER_VERIFICATION_REJECTED,
      'Application rejected',
      reason,
    );

    return this.verificationRepository.findOrCreate(deliveryPartnerId);
  }

  /** Admin-only — APPROVED -> SUSPENDED. */
  async suspend(deliveryPartnerId: string, adminUserId: string) {
    const current =
      await this.verificationRepository.findOrCreate(deliveryPartnerId);

    if (current.stage !== DeliveryVerificationStage.APPROVED) {
      throw new BadRequestException(
        'Only an APPROVED verification can be suspended',
      );
    }

    const claim = await this.verificationRepository.claimStageTransition({
      deliveryPartnerId,

      allowedFromStages: [DeliveryVerificationStage.APPROVED],

      toStage: DeliveryVerificationStage.SUSPENDED,

      isVerifiedUpdate: false,

      history: { fromStage: current.stage, decidedById: adminUserId },
    });

    if (claim.count === 0) {
      throw new ConflictException(
        'This verification is no longer APPROVED — a concurrent admin action already changed it',
      );
    }

    await this.auditService.log(
      adminUserId,
      'DeliveryVerification',
      deliveryPartnerId,
      AuditAction.STATUS_CHANGE,
      { stage: 'APPROVED' },
      { stage: 'SUSPENDED' },
    );

    await this.eventBus.publish('delivery.suspended', { deliveryPartnerId });

    return this.verificationRepository.findOrCreate(deliveryPartnerId);
  }

  async reinstate(deliveryPartnerId: string, adminUserId: string) {
    const current =
      await this.verificationRepository.findOrCreate(deliveryPartnerId);

    if (current.stage !== DeliveryVerificationStage.SUSPENDED) {
      throw new BadRequestException(
        'Only a SUSPENDED verification can be reinstated',
      );
    }

    const claim = await this.verificationRepository.claimStageTransition({
      deliveryPartnerId,

      allowedFromStages: [DeliveryVerificationStage.SUSPENDED],

      toStage: DeliveryVerificationStage.APPROVED,

      isVerifiedUpdate: true,

      history: { fromStage: current.stage, decidedById: adminUserId },
    });

    if (claim.count === 0) {
      throw new ConflictException(
        'This verification is no longer SUSPENDED — a concurrent admin action already changed it',
      );
    }

    await this.auditService.log(
      adminUserId,
      'DeliveryVerification',
      deliveryPartnerId,
      AuditAction.STATUS_CHANGE,
      { stage: 'SUSPENDED' },
      { stage: 'APPROVED' },
    );

    return this.verificationRepository.findOrCreate(deliveryPartnerId);
  }
}
