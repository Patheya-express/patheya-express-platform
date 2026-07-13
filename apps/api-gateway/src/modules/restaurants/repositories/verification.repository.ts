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
}
