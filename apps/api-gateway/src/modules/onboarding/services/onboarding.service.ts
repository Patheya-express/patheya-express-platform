import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

import { AuditAction, OnboardingStatus } from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import { OnboardingRepository } from '../repositories/onboarding.repository';

import { SubmitOnboardingDto } from '../dto/submit-onboarding.dto';
import { RequestOnboardingChangesDto } from '../dto/request-onboarding-changes.dto';
import { ONBOARDING_TOTAL_STEPS } from '../dto/onboarding-response.dto';

import { AuditService } from '../../audit/services/audit.service';
import { RealtimeService } from '../../realtime/services/realtime.service';
import { VerificationService } from '../../restaurants/services/verification.service';
import {
  AuthenticatedUser,
  canAccessRestaurant,
  hasRestaurantRole,
} from '../../../shared/authorization/order-access.util';

const MANAGE_ROLES = ['OWNER', 'CO_OWNER', 'ADMIN'] as const;

/** The wizard's steps 1-11 must all be marked complete before submission — step 12 (Review) is
 *  the act of submitting itself. */
const MANDATORY_STEPS_BEFORE_SUBMIT = Array.from(
  { length: ONBOARDING_TOTAL_STEPS - 1 },
  (_, index) => index + 1,
);

function toResponse(onboarding: {
  id: string;
  restaurantId: string;
  status: OnboardingStatus;
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
      (onboarding.completedSteps.length / ONBOARDING_TOTAL_STEPS) * 100,
    ),
    termsAcceptedAt: onboarding.termsAcceptedAt ?? undefined,
    submittedAt: onboarding.submittedAt ?? undefined,
    decidedAt: onboarding.decidedAt ?? undefined,
    changesRequested: (onboarding.changesRequested as never) ?? undefined,
  };
}

/**
 * Orchestrates the mandatory onboarding wizard on top of the already-completed restaurant
 * modules (branches, staff, documents, tax profile, bank account, verification, settings,
 * media) — this service never writes restaurant/branch/tax/bank/document/media data itself,
 * only tracks wizard progress and delegates the actual "submit for review" transition to the
 * existing VerificationService. See PADK: extend, do not duplicate.
 */
@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly onboardingRepository: OnboardingRepository,
    private readonly auditService: AuditService,
    private readonly realtimeService: RealtimeService,
    private readonly verificationService: VerificationService,
  ) {}

  async getState(restaurantId: string, user: AuthenticatedUser) {
    if (!(await canAccessRestaurant(this.prisma, restaurantId, user))) {
      throw new ForbiddenException('You do not have access to this restaurant');
    }

    const onboarding =
      await this.onboardingRepository.findOrCreate(restaurantId);

    return toResponse(onboarding);
  }

  async completeStep(
    restaurantId: string,
    step: number,
    user: AuthenticatedUser,
  ) {
    await this.assertCanManage(restaurantId, user);

    if (step < 1 || step > ONBOARDING_TOTAL_STEPS) {
      throw new BadRequestException(
        `step must be between 1 and ${ONBOARDING_TOTAL_STEPS}`,
      );
    }

    const updated = await this.onboardingRepository.markStepComplete(
      restaurantId,
      step,
    );

    await this.auditService.log(
      user.userId,
      'RestaurantOnboarding',
      restaurantId,
      AuditAction.UPDATE,
      null,
      { stepCompleted: step },
    );

    return toResponse(updated);
  }

  async submit(
    restaurantId: string,
    dto: SubmitOnboardingDto,
    user: AuthenticatedUser,
  ) {
    await this.assertCanManage(restaurantId, user);

    const current = await this.onboardingRepository.findOrCreate(restaurantId);

    const missingSteps = MANDATORY_STEPS_BEFORE_SUBMIT.filter(
      (step) => !current.completedSteps.includes(step),
    );

    if (missingSteps.length > 0) {
      throw new BadRequestException(
        `Complete steps ${missingSteps.join(', ')} before submitting the application`,
      );
    }

    if (
      current.status !== OnboardingStatus.DRAFT &&
      current.status !== OnboardingStatus.IN_PROGRESS &&
      current.status !== OnboardingStatus.CHANGES_REQUESTED
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
    if (current.status !== OnboardingStatus.CHANGES_REQUESTED) {
      await this.verificationService.submit(restaurantId, user);
    }

    const updated = await this.onboardingRepository.setStatus(
      restaurantId,
      OnboardingStatus.UNDER_REVIEW,
      {
        termsAcceptedAt: new Date(),
        submittedAt: new Date(),
        changesRequested:
          current.status === OnboardingStatus.CHANGES_REQUESTED
            ? []
            : undefined,
      },
    );

    await this.auditService.log(
      user.userId,
      'RestaurantOnboarding',
      restaurantId,
      AuditAction.STATUS_CHANGE,
      { status: current.status },
      { status: OnboardingStatus.UNDER_REVIEW },
    );

    this.realtimeService.emitToRestaurant(
      restaurantId,
      'onboarding.submitted',
      { restaurantId },
    );

    return toResponse(updated);
  }

  /** Admin-only — surfaced as a new action alongside the existing Advance/Reject/Suspend/
   *  Reinstate buttons on the admin verification review screen, not a parallel workflow. */
  async requestChanges(
    restaurantId: string,
    dto: RequestOnboardingChangesDto,
    adminUserId: string,
  ) {
    const updated = await this.onboardingRepository.setStatus(
      restaurantId,
      OnboardingStatus.CHANGES_REQUESTED,
      { changesRequested: dto.items as never },
    );

    await this.auditService.log(
      adminUserId,
      'RestaurantOnboarding',
      restaurantId,
      AuditAction.STATUS_CHANGE,
      null,
      { status: OnboardingStatus.CHANGES_REQUESTED, items: dto.items },
    );

    this.realtimeService.emitToRestaurant(
      restaurantId,
      'onboarding.changes-requested',
      {
        restaurantId,
        items: dto.items,
      },
    );

    return toResponse(updated);
  }

  private async assertCanManage(restaurantId: string, user: AuthenticatedUser) {
    if (
      !(await hasRestaurantRole(this.prisma, restaurantId, user, [
        ...MANAGE_ROLES,
      ]))
    ) {
      throw new ForbiddenException(
        'You do not have permission to manage this restaurant’s onboarding application',
      );
    }
  }
}
