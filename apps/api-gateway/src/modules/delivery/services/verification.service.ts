import {
  BadRequestException,
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

  private async transition(
    deliveryPartnerId: string,
    toStage: DeliveryVerificationStage,
    extra: {
      submittedAt?: Date;
      decidedAt?: Date;
      rejectedReason?: string | null;
    } = {},
    fromStage?: DeliveryVerificationStage,
    reason?: string,
    decidedById?: string,
  ) {
    const updated = await this.verificationRepository.setStage(
      deliveryPartnerId,
      toStage,
      extra,
    );

    await this.verificationRepository.recordHistory({
      deliveryPartnerId,
      fromStage: fromStage ?? null,
      toStage,
      reason,
      decidedById,
    });

    return updated;
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

    const updated = await this.transition(
      partner.id,
      DeliveryVerificationStage.SUBMITTED,
      { submittedAt: new Date() },
      current.stage,
      undefined,
      userId,
    );

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

    return updated;
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

    const updated = await this.transition(
      deliveryPartnerId,
      nextStage,
      extra,
      current.stage,
      undefined,
      adminUserId,
    );

    await this.auditService.log(
      adminUserId,
      'DeliveryVerification',
      deliveryPartnerId,
      AuditAction.STATUS_CHANGE,
      { stage: current.stage },
      { stage: nextStage },
    );

    if (nextStage === DeliveryVerificationStage.APPROVED) {
      await this.deliveryRepository.updateVerification(deliveryPartnerId, true);

      await this.eventBus.publish('delivery.approved', { deliveryPartnerId });

      const partner = await this.requirePartnerById(deliveryPartnerId);

      await this.notificationsService.createNotification(
        partner.userId,
        NotificationType.DELIVERY_PARTNER_VERIFICATION_APPROVED,
        'Application approved',
        'Your delivery partner application has been approved. You can now go online and receive orders.',
      );
    }

    return updated;
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

    const updated = await this.transition(
      deliveryPartnerId,
      DeliveryVerificationStage.REJECTED,
      { decidedAt: new Date(), rejectedReason: reason },
      current.stage,
      reason,
      adminUserId,
    );

    await this.deliveryRepository.updateVerification(deliveryPartnerId, false);

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

    return updated;
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

    const updated = await this.transition(
      deliveryPartnerId,
      DeliveryVerificationStage.SUSPENDED,
      {},
      current.stage,
      undefined,
      adminUserId,
    );

    await this.deliveryRepository.updateVerification(deliveryPartnerId, false);

    await this.auditService.log(
      adminUserId,
      'DeliveryVerification',
      deliveryPartnerId,
      AuditAction.STATUS_CHANGE,
      { stage: 'APPROVED' },
      { stage: 'SUSPENDED' },
    );

    await this.eventBus.publish('delivery.suspended', { deliveryPartnerId });

    return updated;
  }

  async reinstate(deliveryPartnerId: string, adminUserId: string) {
    const current =
      await this.verificationRepository.findOrCreate(deliveryPartnerId);

    if (current.stage !== DeliveryVerificationStage.SUSPENDED) {
      throw new BadRequestException(
        'Only a SUSPENDED verification can be reinstated',
      );
    }

    const updated = await this.transition(
      deliveryPartnerId,
      DeliveryVerificationStage.APPROVED,
      {},
      current.stage,
      undefined,
      adminUserId,
    );

    await this.deliveryRepository.updateVerification(deliveryPartnerId, true);

    await this.auditService.log(
      adminUserId,
      'DeliveryVerification',
      deliveryPartnerId,
      AuditAction.STATUS_CHANGE,
      { stage: 'SUSPENDED' },
      { stage: 'APPROVED' },
    );

    return updated;
  }
}
