import { Injectable } from '@nestjs/common';

import { DeliveryVerificationStage, Prisma } from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import { BaseRepository } from '../../../infrastructure/database/repositories/base.repository';

type TransactionClient = Prisma.TransactionClient;

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

  /**
   * Sprint 1.9 — the exactly-once claim behind every verification stage transition
   * (submit/advance/reject/suspend/reinstate), same philosophy as
   * RestaurantsRepository.claimStatusTransition, extended to also bundle the two writes that used
   * to happen as separate, non-transactional follow-up calls (DeliveryRepository.updateVerification
   * and VerificationRepository.recordHistory) into the SAME transaction as the stage claim. That
   * bundling is what makes "verification completion and activation become atomic" (Phase 4) real:
   * previously a crash or an interleaved concurrent request between setStage() and
   * updateVerification() could leave DeliveryVerification.stage saying APPROVED while
   * DeliveryPartner.isVerified was still false (or vice versa) — the exact "verification and
   * entity status can become inconsistent" finding this sprint exists to close. Reaching into
   * `deliveryPartner` from this repository (not `DeliveryRepository`) mirrors the precedent already
   * set by WalletRepository.applyToOrderAtomic, which reaches into `order` from the wallet
   * repository for the same reason: one atomic cross-aggregate invariant needs one transaction,
   * regardless of which repository conventionally "owns" each table.
   */
  async claimStageTransition(params: {
    deliveryPartnerId: string;
    allowedFromStages: DeliveryVerificationStage[];
    toStage: DeliveryVerificationStage;
    extra?: {
      submittedAt?: Date;
      decidedAt?: Date;
      rejectedReason?: string | null;
    };
    isVerifiedUpdate?: boolean;
    history?: {
      fromStage: DeliveryVerificationStage | null;
      reason?: string;
      decidedById?: string;
    };
  }): Promise<{ count: number }> {
    return this.prisma.$transaction(async (tx: TransactionClient) => {
      const stageClaim = await tx.deliveryVerification.updateMany({
        where: {
          deliveryPartnerId: params.deliveryPartnerId,

          stage: { in: params.allowedFromStages },
        },

        data: { stage: params.toStage, ...params.extra },
      });

      if (stageClaim.count === 0) {
        return { count: 0 };
      }

      if (params.isVerifiedUpdate !== undefined) {
        await tx.deliveryPartner.update({
          where: { id: params.deliveryPartnerId },

          data: { isVerified: params.isVerifiedUpdate },
        });
      }

      if (params.history) {
        await tx.verificationHistory.create({
          data: {
            deliveryPartnerId: params.deliveryPartnerId,

            fromStage: params.history.fromStage,

            toStage: params.toStage,

            reason: params.history.reason,

            decidedById: params.history.decidedById,
          },
        });
      }

      return { count: stageClaim.count };
    });
  }
}
