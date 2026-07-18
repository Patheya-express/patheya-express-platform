import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  AuditAction,
  DeliveryOnboardingStatus,
  NotificationType,
} from '@prisma/client';

import { DeliveryRepository } from '../repositories/delivery.repository';
import { OnboardingRepository } from '../repositories/onboarding.repository';

import { SubmitDeliveryOnboardingDto } from '../dto/submit-delivery-onboarding.dto';
import { RequestDeliveryOnboardingChangesDto } from '../dto/request-delivery-onboarding-changes.dto';
import { DELIVERY_ONBOARDING_TOTAL_STEPS } from '../dto/delivery-onboarding-response.dto';

import { AuditService } from '../../audit/services/audit.service';
import { RealtimeService } from '../../realtime/services/realtime.service';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { VerificationService } from './verification.service';

/** Steps 1-11 must all be marked complete before submission — step 12 (Review) is the act of
 *  submitting itself. */
const MANDATORY_STEPS_BEFORE_SUBMIT = Array.from(
  { length: DELIVERY_ONBOARDING_TOTAL_STEPS - 1 },
  (_, index) => index + 1,
);

function toResponse(onboarding: {
  id: string;
  deliveryPartnerId: string;
  status: DeliveryOnboardingStatus;
  currentStep: number;
  completedSteps: number[];
  termsAcceptedAt: Date | null;
  submittedAt: Date | null;
  decidedAt: Date | null;
  changesRequested: unknown;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...onboarding,
    progressPercent: Math.round(
      (onboarding.completedSteps.length / DELIVERY_ONBOARDING_TOTAL_STEPS) *
        100,
    ),
    termsAcceptedAt: onboarding.termsAcceptedAt ?? undefined,
    submittedAt: onboarding.submittedAt ?? undefined,
    decidedAt: onboarding.decidedAt ?? undefined,
    changesRequested: (onboarding.changesRequested as never) ?? undefined,
  };
}

/**
 * Orchestrates the mandatory onboarding wizard on top of the already-built delivery-partner
 * submodules (vehicles, documents, bank account, verification) — this service never writes
 * vehicle/document/bank data itself, only tracks wizard progress and delegates the actual
 * "submit for review" transition to the existing VerificationService. Exact mirror of the
 * restaurant OnboardingService.
 */
@Injectable()
export class OnboardingService {
  constructor(
    private readonly deliveryRepository: DeliveryRepository,
    private readonly onboardingRepository: OnboardingRepository,
    private readonly auditService: AuditService,
    private readonly realtimeService: RealtimeService,
    private readonly notificationsService: NotificationsService,
    private readonly verificationService: VerificationService,
  ) {}

  private async requirePartner(userId: string) {
    const partner = await this.deliveryRepository.findPartnerByUserId(userId);

    if (!partner) {
      throw new NotFoundException('Delivery partner not found');
    }

    return partner;
  }

  async getState(userId: string) {
    const partner = await this.requirePartner(userId);

    const onboarding = await this.onboardingRepository.findOrCreate(partner.id);

    return toResponse(onboarding);
  }

  async completeStep(userId: string, step: number) {
    const partner = await this.requirePartner(userId);

    if (step < 1 || step > DELIVERY_ONBOARDING_TOTAL_STEPS) {
      throw new BadRequestException(
        `step must be between 1 and ${DELIVERY_ONBOARDING_TOTAL_STEPS}`,
      );
    }

    const updated = await this.onboardingRepository.markStepComplete(
      partner.id,
      step,
    );

    await this.auditService.log(
      userId,
      'DeliveryOnboarding',
      partner.id,
      AuditAction.UPDATE,
      null,
      { stepCompleted: step },
    );

    return toResponse(updated);
  }

  async submit(userId: string, dto: SubmitDeliveryOnboardingDto) {
    const partner = await this.requirePartner(userId);

    const current = await this.onboardingRepository.findOrCreate(partner.id);

    const missingSteps = MANDATORY_STEPS_BEFORE_SUBMIT.filter(
      (step) => !current.completedSteps.includes(step),
    );

    if (missingSteps.length > 0) {
      throw new BadRequestException(
        `Complete steps ${missingSteps.join(', ')} before submitting the application`,
      );
    }

    if (
      current.status !== DeliveryOnboardingStatus.DRAFT &&
      current.status !== DeliveryOnboardingStatus.IN_PROGRESS &&
      current.status !== DeliveryOnboardingStatus.CHANGES_REQUESTED
    ) {
      throw new BadRequestException(
        `An application in status ${current.status} cannot be submitted`,
      );
    }

    // VerificationService.submit() is a one-time DRAFT -> SUBMITTED transition on the
    // verification stage machine, so it's only invoked the first time the application is
    // submitted. A CHANGES_REQUESTED resubmission is an onboarding-only concept — the
    // verification stage was never reset and stays wherever the admin's Advance/Reject actions
    // left it — so resubmitting just moves the onboarding status back to UNDER_REVIEW without
    // touching verification at all.
    if (current.status !== DeliveryOnboardingStatus.CHANGES_REQUESTED) {
      await this.verificationService.submit(userId);
    }

    const updated = await this.onboardingRepository.setStatus(
      partner.id,
      DeliveryOnboardingStatus.UNDER_REVIEW,
      {
        termsAcceptedAt: new Date(),
        submittedAt: new Date(),
        changesRequested:
          current.status === DeliveryOnboardingStatus.CHANGES_REQUESTED
            ? []
            : undefined,
      },
    );

    await this.auditService.log(
      userId,
      'DeliveryOnboarding',
      partner.id,
      AuditAction.STATUS_CHANGE,
      { status: current.status },
      {
        status: DeliveryOnboardingStatus.UNDER_REVIEW,
        acceptedTerms: dto.acceptedTerms,
      },
    );

    this.realtimeService.emitToUser(userId, 'delivery.onboarding.submitted', {
      deliveryPartnerId: partner.id,
    });

    return toResponse(updated);
  }

  /** Admin-only — surfaced alongside the verification Advance/Reject/Suspend/Reinstate actions,
   *  not a parallel workflow. */
  async requestChanges(
    deliveryPartnerId: string,
    dto: RequestDeliveryOnboardingChangesDto,
    adminUserId: string,
  ) {
    const partner = await this.deliveryRepository.findById(deliveryPartnerId);

    if (!partner) {
      throw new NotFoundException('Delivery partner not found');
    }

    const updated = await this.onboardingRepository.setStatus(
      deliveryPartnerId,
      DeliveryOnboardingStatus.CHANGES_REQUESTED,
      { changesRequested: dto.items as never },
    );

    await this.auditService.log(
      adminUserId,
      'DeliveryOnboarding',
      deliveryPartnerId,
      AuditAction.STATUS_CHANGE,
      null,
      { status: DeliveryOnboardingStatus.CHANGES_REQUESTED, items: dto.items },
    );

    this.realtimeService.emitToUser(
      partner.userId,
      'delivery.onboarding.changes-requested',
      { deliveryPartnerId, items: dto.items },
    );

    await this.notificationsService.createNotification(
      partner.userId,
      NotificationType.DELIVERY_PARTNER_CHANGES_REQUESTED,
      'Changes requested',
      'The admin has requested changes to your application. Please review and resubmit.',
      { items: dto.items },
    );

    return toResponse(updated);
  }
}
