import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

import { AuditAction, RestaurantVerificationStage } from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import { VerificationRepository } from '../repositories/verification.repository';

import { AuditService } from '../../audit/services/audit.service';
import { EventBusService } from '../../../core/events/event-bus.service';
import {
  AuthenticatedUser,
  canAccessRestaurant,
  hasRestaurantRole,
} from '../../../shared/authorization/order-access.util';

/**
 * Linear forward path. REJECTED/SUSPENDED are side-branches reachable from any non-terminal
 * stage (reject) or from APPROVED (suspend) rather than positions in this array.
 */
const STAGE_ORDER: RestaurantVerificationStage[] = [
  RestaurantVerificationStage.DRAFT,
  RestaurantVerificationStage.SUBMITTED,
  RestaurantVerificationStage.DOCUMENT_REVIEW,
  RestaurantVerificationStage.GST_VERIFICATION,
  RestaurantVerificationStage.FSSAI_VERIFICATION,
  RestaurantVerificationStage.BANK_VERIFICATION,
  RestaurantVerificationStage.COMPLIANCE_REVIEW,
  RestaurantVerificationStage.APPROVED,
];

const MANAGE_ROLES = ['OWNER', 'CO_OWNER', 'ADMIN'] as const;

/** Every stage reject() may legally act on — everything in the forward path except the two
 *  terminal-for-reject stages (REJECTED itself, and APPROVED — matches the pre-existing JS check
 *  this replaces exactly: `stage === REJECTED || stage === APPROVED` were the only two excluded). */
const REJECTABLE_STAGES = STAGE_ORDER.filter(
  (stage) => stage !== RestaurantVerificationStage.APPROVED,
);

/**
 * Deliberately decoupled from RestaurantStatus — reaching RestaurantVerificationStage.APPROVED
 * does not automatically flip Restaurant.status. The existing admin approve/reject/suspend/
 * restore endpoints on RestaurantsController remain the sole, unchanged path for that — this
 * stays purely additive so no existing admin workflow silently changes behavior. A future phase
 * could wire the two together once that behavior change is explicitly approved.
 */
@Injectable()
export class VerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly verificationRepository: VerificationRepository,
    private readonly auditService: AuditService,
    private readonly eventBus: EventBusService,
  ) {}

  async getStatus(restaurantId: string, user: AuthenticatedUser) {
    if (!(await canAccessRestaurant(this.prisma, restaurantId, user))) {
      throw new ForbiddenException('You do not have access to this restaurant');
    }

    return this.verificationRepository.findOrCreate(restaurantId);
  }

  async submit(restaurantId: string, user: AuthenticatedUser) {
    if (
      !(await hasRestaurantRole(this.prisma, restaurantId, user, [
        ...MANAGE_ROLES,
      ]))
    ) {
      throw new ForbiddenException(
        'You do not have permission to submit this restaurant for verification',
      );
    }

    const current =
      await this.verificationRepository.findOrCreate(restaurantId);

    if (current.stage !== RestaurantVerificationStage.DRAFT) {
      throw new BadRequestException(
        'Only a DRAFT verification can be submitted',
      );
    }

    const claim = await this.verificationRepository.claimStageTransition(
      restaurantId,

      [RestaurantVerificationStage.DRAFT],

      RestaurantVerificationStage.SUBMITTED,

      { submittedAt: new Date() },
    );

    if (claim.count === 0) {
      throw new ConflictException(
        'This verification is no longer DRAFT — it was already submitted',
      );
    }

    await this.auditService.log(
      user.userId,
      'RestaurantVerification',
      restaurantId,
      AuditAction.STATUS_CHANGE,
      { stage: 'DRAFT' },
      { stage: 'SUBMITTED' },
    );

    return this.verificationRepository.findOrCreate(restaurantId);
  }

  /** Admin-only — moves to the next stage in STAGE_ORDER. */
  async advance(restaurantId: string, adminUserId: string) {
    const current =
      await this.verificationRepository.findOrCreate(restaurantId);

    const currentIndex = STAGE_ORDER.indexOf(current.stage);

    if (currentIndex === -1 || currentIndex === STAGE_ORDER.length - 1) {
      throw new BadRequestException(
        `Verification at stage ${current.stage} cannot be advanced further`,
      );
    }

    const nextStage = STAGE_ORDER[currentIndex + 1];

    const extra =
      nextStage === RestaurantVerificationStage.APPROVED
        ? { decidedAt: new Date() }
        : {};

    // The authoritative check: `current.stage` above is a snapshot, not proof the row is still
    // there right now — a concurrent advance/reject on this same verification may have already
    // claimed it. The conditional updateMany is what actually enforces "exactly one winner."
    const claim = await this.verificationRepository.claimStageTransition(
      restaurantId,

      [current.stage],

      nextStage,

      extra,
    );

    if (claim.count === 0) {
      throw new ConflictException(
        `This verification is no longer at stage ${current.stage} — a concurrent admin action already changed it`,
      );
    }

    await this.auditService.log(
      adminUserId,
      'RestaurantVerification',
      restaurantId,
      AuditAction.STATUS_CHANGE,
      { stage: current.stage },
      { stage: nextStage },
    );

    if (nextStage === RestaurantVerificationStage.APPROVED) {
      await this.eventBus.publish('restaurant.verification.completed', {
        restaurantId,
      });
    }

    return this.verificationRepository.findOrCreate(restaurantId);
  }

  /** Admin-only — rejects from any non-terminal stage. */
  async reject(restaurantId: string, reason: string, adminUserId: string) {
    const current =
      await this.verificationRepository.findOrCreate(restaurantId);

    if (
      current.stage === RestaurantVerificationStage.REJECTED ||
      current.stage === RestaurantVerificationStage.APPROVED
    ) {
      throw new BadRequestException(
        `Verification at stage ${current.stage} cannot be rejected`,
      );
    }

    const claim = await this.verificationRepository.claimStageTransition(
      restaurantId,

      REJECTABLE_STAGES,

      RestaurantVerificationStage.REJECTED,

      { decidedAt: new Date(), rejectedReason: reason },
    );

    if (claim.count === 0) {
      throw new ConflictException(
        'This verification can no longer be rejected — a concurrent admin action already approved or rejected it',
      );
    }

    await this.auditService.log(
      adminUserId,
      'RestaurantVerification',
      restaurantId,
      AuditAction.REJECT,
      { stage: current.stage },
      { stage: 'REJECTED', reason },
    );

    await this.eventBus.publish('restaurant.verification.rejected', {
      restaurantId,
      reason,
    });

    return this.verificationRepository.findOrCreate(restaurantId);
  }

  /** Admin-only — APPROVED -> SUSPENDED, mirroring RestaurantsService's own suspend/restore
   *  pair but for the verification aggregate specifically. */
  async suspend(restaurantId: string, adminUserId: string) {
    const current =
      await this.verificationRepository.findOrCreate(restaurantId);

    if (current.stage !== RestaurantVerificationStage.APPROVED) {
      throw new BadRequestException(
        'Only an APPROVED verification can be suspended',
      );
    }

    const claim = await this.verificationRepository.claimStageTransition(
      restaurantId,

      [RestaurantVerificationStage.APPROVED],

      RestaurantVerificationStage.SUSPENDED,
    );

    if (claim.count === 0) {
      throw new ConflictException(
        'This verification is no longer APPROVED — a concurrent admin action already changed it',
      );
    }

    await this.auditService.log(
      adminUserId,
      'RestaurantVerification',
      restaurantId,
      AuditAction.STATUS_CHANGE,
      { stage: 'APPROVED' },
      { stage: 'SUSPENDED' },
    );

    return this.verificationRepository.findOrCreate(restaurantId);
  }

  async reinstate(restaurantId: string, adminUserId: string) {
    const current =
      await this.verificationRepository.findOrCreate(restaurantId);

    if (current.stage !== RestaurantVerificationStage.SUSPENDED) {
      throw new BadRequestException(
        'Only a SUSPENDED verification can be reinstated',
      );
    }

    const claim = await this.verificationRepository.claimStageTransition(
      restaurantId,

      [RestaurantVerificationStage.SUSPENDED],

      RestaurantVerificationStage.APPROVED,
    );

    if (claim.count === 0) {
      throw new ConflictException(
        'This verification is no longer SUSPENDED — a concurrent admin action already changed it',
      );
    }

    await this.auditService.log(
      adminUserId,
      'RestaurantVerification',
      restaurantId,
      AuditAction.STATUS_CHANGE,
      { stage: 'SUSPENDED' },
      { stage: 'APPROVED' },
    );

    return this.verificationRepository.findOrCreate(restaurantId);
  }
}
