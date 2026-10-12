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

  /** Everything the wizard steps persist, in one read — the evidence OnboardingService checks
   *  before a step may be marked complete (see onboarding-step-requirements.ts). */
  findStepEvidence(deliveryPartnerId: string) {
    return this.prisma.deliveryPartner.findUnique({
      where: { id: deliveryPartnerId },
      select: {
        dateOfBirth: true,
        gender: true,
        languagesSpoken: true,
        currentAddressLine1: true,
        currentCity: true,
        currentState: true,
        currentPostalCode: true,
        currentAddressLatitude: true,
        currentAddressLongitude: true,
        vehicles: { where: { isActive: true }, select: { id: true } },
        documents: { select: { documentType: true } },
        bankAccount: { select: { deliveryPartnerId: true } },
        onboarding: { select: { backgroundCheckConsentAt: true } },
      },
    });
  }

  /** Records background-check consent once; a repeat call keeps the original timestamp. */
  async recordBackgroundCheckConsent(deliveryPartnerId: string) {
    await this.findOrCreate(deliveryPartnerId);

    await this.prisma.deliveryOnboarding.updateMany({
      where: { deliveryPartnerId, backgroundCheckConsentAt: null },
      data: { backgroundCheckConsentAt: new Date() },
    });

    return this.findOrCreate(deliveryPartnerId);
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
