import { Injectable } from '@nestjs/common';

import { DeliveryVerificationStage } from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import { BaseRepository } from '../../../infrastructure/database/repositories/base.repository';

@Injectable()
export class VerificationRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  /** Lazily creates the DRAFT-stage aggregate on first access — same pattern as
   *  RestaurantVerification — keeping DeliveryService free of a dependency on this module. */
  async findOrCreate(deliveryPartnerId: string) {
    return this.prisma.deliveryVerification.upsert({
      where: { deliveryPartnerId },
      create: { deliveryPartnerId, stage: DeliveryVerificationStage.DRAFT },
      update: {},
    });
  }

  async setStage(
    deliveryPartnerId: string,
    stage: DeliveryVerificationStage,
    extra: {
      submittedAt?: Date;
      decidedAt?: Date;
      rejectedReason?: string | null;
    } = {},
  ) {
    return this.prisma.deliveryVerification.update({
      where: { deliveryPartnerId },
      data: { stage, ...extra },
    });
  }

  async recordHistory(data: {
    deliveryPartnerId: string;
    fromStage: DeliveryVerificationStage | null;
    toStage: DeliveryVerificationStage;
    reason?: string;
    decidedById?: string;
  }) {
    return this.prisma.verificationHistory.create({ data });
  }

  async findHistory(deliveryPartnerId: string) {
    return this.prisma.verificationHistory.findMany({
      where: { deliveryPartnerId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
