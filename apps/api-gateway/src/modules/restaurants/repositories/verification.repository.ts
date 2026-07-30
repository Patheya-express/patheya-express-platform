import { Injectable } from '@nestjs/common';

import { RestaurantVerificationStage } from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import { BaseRepository } from '../../../infrastructure/database/repositories/base.repository';

@Injectable()
export class VerificationRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  /** Lazily creates the DRAFT-stage aggregate on first access rather than at restaurant
   *  creation time, keeping RestaurantsService free of a dependency on this module. */
  async findOrCreate(restaurantId: string) {
    return this.prisma.restaurantVerification.upsert({
      where: { restaurantId },
      create: { restaurantId, stage: RestaurantVerificationStage.DRAFT },
      update: {},
    });
  }

  async setStage(
    restaurantId: string,
    stage: RestaurantVerificationStage,
    extra: {
      submittedAt?: Date;
      decidedAt?: Date;
      rejectedReason?: string | null;
    } = {},
  ) {
    return this.prisma.restaurantVerification.update({
      where: { restaurantId },
      data: { stage, ...extra },
    });
  }

  /**
   * Sprint 1.9 — the exactly-once claim behind every verification stage transition
   * (submit/advance/reject/suspend/reinstate), same philosophy as
   * RestaurantsRepository.claimStatusTransition. Replaces the old find-then-update (setStage),
   * which let two concurrent admin actions on the same verification record (e.g. advance racing
   * reject) both pass their JS stage check and both write.
   */
  async claimStageTransition(
    restaurantId: string,

    allowedFromStages: RestaurantVerificationStage[],

    toStage: RestaurantVerificationStage,

    extra: {
      submittedAt?: Date;
      decidedAt?: Date;
      rejectedReason?: string | null;
    } = {},
  ): Promise<{ count: number }> {
    return this.prisma.restaurantVerification.updateMany({
      where: {
        restaurantId,

        stage: { in: allowedFromStages },
      },

      data: { stage: toStage, ...extra },
    });
  }
}
