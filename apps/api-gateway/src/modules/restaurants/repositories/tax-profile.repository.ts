import { Injectable } from '@nestjs/common';

import { VerificationStatus } from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import { BaseRepository } from '../../../infrastructure/database/repositories/base.repository';

@Injectable()
export class TaxProfileRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async findByRestaurant(restaurantId: string) {
    return this.prisma.restaurantTaxProfile.findUnique({
      where: { restaurantId },
    });
  }

  async upsert(restaurantId: string, data: any) {
    return this.prisma.restaurantTaxProfile.upsert({
      where: { restaurantId },
      create: { restaurantId, ...data },
      update: data,
    });
  }

  async markGstVerified(restaurantId: string, verifiedById: string) {
    return this.prisma.restaurantTaxProfile.update({
      where: { restaurantId },
      data: {
        gstVerificationStatus: VerificationStatus.VERIFIED,
        gstVerifiedById: verifiedById,
        gstVerifiedAt: new Date(),
      },
    });
  }

  async markGstRejected(restaurantId: string) {
    return this.prisma.restaurantTaxProfile.update({
      where: { restaurantId },
      data: { gstVerificationStatus: VerificationStatus.REJECTED },
    });
  }

  async markFssaiVerified(restaurantId: string, verifiedById: string) {
    return this.prisma.restaurantTaxProfile.update({
      where: { restaurantId },
      data: {
        fssaiVerificationStatus: VerificationStatus.VERIFIED,
        fssaiVerifiedById: verifiedById,
        fssaiVerifiedAt: new Date(),
      },
    });
  }

  async markFssaiRejected(restaurantId: string) {
    return this.prisma.restaurantTaxProfile.update({
      where: { restaurantId },
      data: { fssaiVerificationStatus: VerificationStatus.REJECTED },
    });
  }
}
