import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  Prisma,
  WalletTransaction,
  WalletTransactionType,
} from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

type TransactionClient = Prisma.TransactionClient;

export type ApplyToOrderAtomicResult =
  | {
      outcome: 'applied';
      transaction: WalletTransaction;
      amountApplied: number;
      totalAmount: number;
    }
  | { outcome: 'already_applied' };

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
      (tx) => this.insertLedgerEntry(tx, params),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  /**
   * Atomically claims an order for wallet payment and debits the wallet for the claimed amount
   * in one SERIALIZABLE transaction — closes the race in WalletService.applyToOrder where two
   * concurrent requests could each see `walletAmountUsed === 0` and both debit the wallet for
   * the same order. The claim is a conditional `updateMany` (`WHERE walletAmountUsed = 0 AND
   * paymentStatus != PAID`): Postgres serializes concurrent UPDATEs to the same row regardless
   * of isolation level, so whichever transaction commits first "wins" the claim and the second
   * sees 0 affected rows — no separate `SELECT ... FOR UPDATE` needed. Balance is read and
   * clamped inside the same transaction as the debit, so a genuinely concurrent balance change
   * from an unrelated debit/credit aborts this transaction with a serialization failure (caught
   * and retried by the caller) rather than silently using a stale balance.
   */
  async applyToOrderAtomic(params: {
    userId: string;
    orderId: string;
    requestedAmount: number;
    description: string;
  }): Promise<ApplyToOrderAtomicResult> {
    return this.prisma.$transaction(
      async (tx) => {
        const order = await tx.order.findUnique({
          where: { id: params.orderId },
          select: { totalAmount: true },
        });

        if (!order) {
          throw new NotFoundException('Order not found');
        }

        const totalAmount = Number(order.totalAmount);

        const current = await tx.walletTransaction.aggregate({
          where: { userId: params.userId, status: 'COMPLETED' },
          _sum: { amount: true },
        });

        const balance = Number(current._sum.amount ?? 0);
        const amountToApply = Math.min(
          params.requestedAmount,
          balance,
          totalAmount,
        );

        if (amountToApply <= 0) {
          throw new BadRequestException('Insufficient wallet balance');
        }

        const claim = await tx.order.updateMany({
          where: {
            id: params.orderId,
            walletAmountUsed: 0,
            paymentStatus: { not: 'PAID' },
          },
          data: { walletAmountUsed: amountToApply },
        });

        if (claim.count === 0) {
          return { outcome: 'already_applied' as const };
        }

        const transaction = await this.insertLedgerEntry(tx, {
          userId: params.userId,
          type: WalletTransactionType.ORDER_PAYMENT,
          amount: -amountToApply,
          description: params.description,
          orderId: params.orderId,
        });

        return {
          outcome: 'applied' as const,
          transaction,
          amountApplied: amountToApply,
          totalAmount,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  /** Shared balance-check-then-insert body used by both writeLedgerEntry and
   *  applyToOrderAtomic, each supplying their own transaction boundary. */
  private async insertLedgerEntry(
    tx: TransactionClient,
    params: {
      userId: string;
      type: WalletTransactionType;
      amount: number;
      description: string;
      orderId?: string;
      referralId?: string;
    },
  ): Promise<WalletTransaction> {
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
