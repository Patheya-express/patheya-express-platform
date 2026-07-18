import { Injectable } from '@nestjs/common';

import { DeliveryOnboardingStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import { BaseRepository } from '../../../infrastructure/database/repositories/base.repository';

const TOTAL_STEPS = 12;

@Injectable()
export class OnboardingRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  /** Lazily creates the DRAFT row on first access — same pattern as RestaurantOnboarding — so a
   *  partner created before this phase (or via a race with the creation listener) always has a
   *  row to read. */
  async findOrCreate(deliveryPartnerId: string) {
    const existing = await this.prisma.deliveryOnboarding.findUnique({
      where: { deliveryPartnerId },
    });

    if (existing) {
      return existing;
    }

    return this.prisma.deliveryOnboarding.create({
      data: { deliveryPartnerId },
    });
  }

  async markStepComplete(deliveryPartnerId: string, step: number) {
    const current = await this.findOrCreate(deliveryPartnerId);

    const completedSteps = Array.from(
      new Set([...current.completedSteps, step]),
    ).sort((a, b) => a - b);

    return this.prisma.deliveryOnboarding.update({
      where: { deliveryPartnerId },
      data: {
        completedSteps,
        currentStep: Math.max(
          current.currentStep,
          Math.min(step + 1, TOTAL_STEPS),
        ),
        status:
          current.status === DeliveryOnboardingStatus.DRAFT
            ? DeliveryOnboardingStatus.IN_PROGRESS
            : undefined,
      },
    });
  }

  async setStatus(
    deliveryPartnerId: string,
    status: DeliveryOnboardingStatus,
    extra: Prisma.DeliveryOnboardingUpdateInput = {},
  ) {
    await this.findOrCreate(deliveryPartnerId);

    return this.prisma.deliveryOnboarding.update({
      where: { deliveryPartnerId },
      data: { status, ...extra },
    });
  }

  async findByPartnerId(deliveryPartnerId: string) {
    return this.prisma.deliveryOnboarding.findUnique({
      where: { deliveryPartnerId },
    });
  }
}
