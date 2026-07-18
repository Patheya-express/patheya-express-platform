import { Injectable } from '@nestjs/common';

import { OnboardingStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import { BaseRepository } from '../../../infrastructure/database/repositories/base.repository';

@Injectable()
export class OnboardingRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  /** Lazily creates the DRAFT row on first access — same pattern as RestaurantSettings — so a
   *  restaurant created before this phase (or via a race with the creation listener) always has
   *  a row to read. */
  async findOrCreate(restaurantId: string) {
    const existing = await this.prisma.restaurantOnboarding.findUnique({
      where: { restaurantId },
    });

    if (existing) {
      return existing;
    }

    return this.prisma.restaurantOnboarding.create({
      data: { restaurantId },
    });
  }

  async markStepComplete(restaurantId: string, step: number) {
    const current = await this.findOrCreate(restaurantId);

    const completedSteps = Array.from(
      new Set([...current.completedSteps, step]),
    ).sort((a, b) => a - b);

    return this.prisma.restaurantOnboarding.update({
      where: { restaurantId },
      data: {
        completedSteps,
        currentStep: Math.max(current.currentStep, Math.min(step + 1, 12)),
        status:
          current.status === OnboardingStatus.DRAFT
            ? OnboardingStatus.IN_PROGRESS
            : undefined,
      },
    });
  }

  async setStatus(
    restaurantId: string,
    status: OnboardingStatus,
    extra: Prisma.RestaurantOnboardingUpdateInput = {},
  ) {
    await this.findOrCreate(restaurantId);

    return this.prisma.restaurantOnboarding.update({
      where: { restaurantId },
      data: { status, ...extra },
    });
  }

  async findByRestaurantId(restaurantId: string) {
    return this.prisma.restaurantOnboarding.findUnique({
      where: { restaurantId },
    });
  }
}
