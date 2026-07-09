import { BadRequestException, Injectable } from '@nestjs/common';

import { Prisma, WalletTransactionType } from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

export const WALLET_TRANSACTION_ADMIN_INCLUDE = {
  user: {
    select: { id: true, firstName: true, lastName: true, email: true },
  },
} as const;

@Injectable()
export class WalletRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getBalance(userId: string): Promise<number> {
    const result = await this.prisma.walletTransaction.aggregate({
      where: { userId, status: 'COMPLETED' },
      _sum: { amount: true },
    });

    return Number(result._sum.amount ?? 0);
  }

  /**
   * The single write path for every wallet ledger entry. Runs at SERIALIZABLE isolation so two
   * concurrent writes for the same user (e.g. a debit and a refund credit landing at once)
   * cannot both read the same "current balance" and produce an inconsistent balanceAfter —
   * Postgres aborts one with a serialization failure instead, which the caller retries.
   */
  async writeLedgerEntry(params: {
    userId: string;
    type: WalletTransactionType;
    amount: number;
    description: string;
    orderId?: string;
    referralId?: string;
  }) {
    return this.prisma.$transaction(
      async (tx) => {
        const current = await tx.walletTransaction.aggregate({
          where: { userId: params.userId, status: 'COMPLETED' },
          _sum: { amount: true },
        });

        const balanceBefore = Number(current._sum.amount ?? 0);
        const balanceAfter = balanceBefore + params.amount;

        if (balanceAfter < 0) {
          throw new BadRequestException('Insufficient wallet balance');
        }

        return tx.walletTransaction.create({
          data: {
            userId: params.userId,
            type: params.type,
            amount: params.amount,
            balanceAfter,
            description: params.description,
            orderId: params.orderId,
            referralId: params.referralId,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async findTransactions(userId: string, skip: number, take: number) {
    const where: Prisma.WalletTransactionWhereInput = { userId };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.walletTransaction.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),

      this.prisma.walletTransaction.count({ where }),
    ]);

    return { items, total };
  }

  async findAllForAdmin(params: {
    userId?: string;
    skip: number;
    take: number;
  }) {
    const where: Prisma.WalletTransactionWhereInput = params.userId
      ? { userId: params.userId }
      : {};

    const [items, total] = await this.prisma.$transaction([
      this.prisma.walletTransaction.findMany({
        where,
        skip: params.skip,
        take: params.take,
        orderBy: { createdAt: 'desc' },
        include: WALLET_TRANSACTION_ADMIN_INCLUDE,
      }),

      this.prisma.walletTransaction.count({ where }),
    ]);

    return { items, total };
  }

  async findOrderForWallet(orderId: string) {
    return this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        customerId: true,
        totalAmount: true,
        walletAmountUsed: true,
        paymentStatus: true,
      },
    });
  }

  async setOrderWalletAmount(orderId: string, walletAmountUsed: number) {
    return this.prisma.order.update({
      where: { id: orderId },
      data: { walletAmountUsed },
    });
  }

  async findReferralByReferee(refereeId: string) {
    return this.prisma.referral.findUnique({ where: { refereeId } });
  }

  async markReferralRewarded(referralId: string, rewardAmount: number) {
    return this.prisma.referral.update({
      where: { id: referralId },
      data: {
        status: 'REWARDED',
        rewardAmount,
        rewardedAt: new Date(),
      },
    });
  }

  /**
   * Lazily backfills a referral code for users who existed before this feature shipped (only
   * new signups get one assigned at registration time). Deterministic from the user's own id,
   * same scheme AuthService uses, so it's stable even if called concurrently.
   */
  async findReferralCode(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { referralCode: true },
    });

    if (!user) {
      return null;
    }

    if (user.referralCode) {
      return user.referralCode;
    }

    const referralCode = userId.replace(/-/g, '').slice(0, 8).toUpperCase();

    await this.prisma.user.update({
      where: { id: userId },
      data: { referralCode },
    });

    return referralCode;
  }

  async getReferralSummary(referrerId: string) {
    const [totalReferred, totalRewarded, earnedAgg] =
      await this.prisma.$transaction([
        this.prisma.referral.count({ where: { referrerId } }),
        this.prisma.referral.count({
          where: { referrerId, status: 'REWARDED' },
        }),
        this.prisma.walletTransaction.aggregate({
          where: {
            userId: referrerId,
            type: 'REFERRAL_REWARD',
            status: 'COMPLETED',
          },
          _sum: { amount: true },
        }),
      ]);

    return {
      totalReferred,
      totalRewarded,
      totalEarned: Number(earnedAgg._sum.amount ?? 0),
    };
  }

  /** Count of DELIVERED orders for this customer — used to detect "this is their first delivered order" without a denormalized counter. */
  async countDeliveredOrders(customerId: string): Promise<number> {
    return this.prisma.order.count({
      where: { customerId, status: 'DELIVERED' },
    });
  }
}
