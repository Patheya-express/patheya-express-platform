import { Injectable } from '@nestjs/common';

import {
  ComplianceOverallStatus,
  DeliveryDocumentType,
  DeliveryVerificationStage,
  VerificationStatus,
} from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import { BaseRepository } from '../../../infrastructure/database/repositories/base.repository';

@Injectable()
export class ComplianceRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  /** Write-through cache — upserted every time getSnapshot() computes a fresh result. The
   *  endpoint itself always returns the freshly computed value, never a stale read of this row;
   *  this only exists so other parts of the platform (e.g. a future dashboard widget) can read
   *  "last computed readiness" without recomputation. */
  async upsertSnapshot(
    deliveryPartnerId: string,
    data: {
      overallStatus: ComplianceOverallStatus;
      verificationStage: DeliveryVerificationStage;
      documentsTotal: number;
      documentsVerified: number;
      documentsPending: number;
      documentsRejected: number;
      bankVerificationStatus?: VerificationStatus;
      missingDocumentTypes: DeliveryDocumentType[];
    },
  ) {
    return this.prisma.deliveryComplianceSnapshot.upsert({
      where: { deliveryPartnerId },
      create: { deliveryPartnerId, ...data },
      update: data,
    });
  }
}
