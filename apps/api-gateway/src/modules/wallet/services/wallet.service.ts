import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  Prisma,
  WalletTransaction,
  WalletTransactionType,
} from '@prisma/client';

import {
  WalletRepository,
  WALLET_TRANSACTION_ADMIN_INCLUDE,
} from '../repositories/wallet.repository';

import { RealtimeService } from '../../realtime/services/realtime.service';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { AuditService } from '../../audit/services/audit.service';
import { EventBusService } from '../../../core/events/event-bus.service';

import { NotificationType, AuditAction } from '@prisma/client';

import { WalletTransactionResponseDto } from '../dto/wallet-transaction-response.dto';
import { PaginatedWalletTransactionsResponseDto } from '../dto/paginated-wallet-transactions-response.dto';
import { ApplyWalletToOrderResponseDto } from '../dto/apply-wallet-to-order-response.dto';
import { AdminWalletTransactionResponseDto } from '../dto/admin-wallet-transaction-response.dto';
import { PaginatedAdminWalletTransactionsResponseDto } from '../dto/paginated-admin-wallet-transactions-response.dto';
import { ReferralSummaryResponseDto } from '../dto/referral-summary-response.dto';

/** Flat cashback rate credited to wallet when an order reaches DELIVERED (approved C9 decision: flat % cashback, no separate points currency). */
export const CASHBACK_RATE = 0.02;

/** Flat wallet credit for both sides of a successful referral (approved C9 decision: reward both users, on the referee's first DELIVERED order). */
export const REFERRAL_REWARD_AMOUNT = 50;

const MAX_SERIALIZATION_RETRIES = 2;

type WalletTransactionWithUser = Prisma.WalletTransactionGetPayload<{
  include: typeof WALLET_TRANSACTION_ADMIN_INCLUDE;
}>;

function toTransactionResponse(
  tx: WalletTransaction,
): WalletTransactionResponseDto {
  return {
    id: tx.id,
    type: tx.type,
    status: tx.status,
    amount: Number(tx.amount),
    balanceAfter: Number(tx.balanceAfter),
    orderId: tx.orderId ?? undefined,
    referralId: tx.referralId ?? undefined,
    description: tx.description,
    createdAt: tx.createdAt,
  };
}

function isSerializationFailure(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2034'
  );
}

@Injectable()
export class WalletService {
  constructor(
    private readonly walletRepository: WalletRepository,
    private readonly realtimeService: RealtimeService,
    private readonly notificationsService: NotificationsService,
    private readonly auditService: AuditService,
    private readonly eventBus: EventBusService,
  ) {}

  async getBalance(userId: string): Promise<number> {
    return this.walletRepository.getBalance(userId);
  }

  async getTransactions(
    userId: string,
    page: number,
    limit: number,
  ): Promise<PaginatedWalletTransactionsResponseDto> {
    const skip = (page - 1) * limit;
    const { items, total } = await this.walletRepository.findTransactions(
      userId,
      skip,
      limit,
    );

    return {
      items: items.map(toTransactionResponse),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * The single write path every wallet-crediting/-debiting caller in this module goes through —
   * retries once on a Postgres serialization failure (two concurrent writes for the same user),
   * pushes a realtime balance update, records a notification for credits, and audits every entry.
   */
  private async writeLedgerEntry(
    userId: string,
    type: WalletTransactionType,
    amount: number,
    description: string,
    opts: { orderId?: string; referralId?: string } = {},
    attempt = 0,
  ): Promise<WalletTransaction> {
    try {
      const tx = await this.walletRepository.writeLedgerEntry({
        userId,
        type,
        amount,
        description,
        ...opts,
      });

      this.realtimeService.emitToUser(userId, 'wallet.balance.changed', {
        balance: Number(tx.balanceAfter),
        transaction: toTransactionResponse(tx),
      });

      await this.auditService.log(
        userId,
        'WalletTransaction',
        tx.id,
        AuditAction.CREATE,
        undefined,
        { type, amount, balanceAfter: Number(tx.balanceAfter) },
      );

      if (amount > 0) {
        await this.notificationsService.createNotification(
          userId,
          NotificationType.WALLET_CREDIT,
          'Wallet credited',
          `${description} — ₹${amount.toFixed(2)} added to your wallet.`,
          { referenceType: 'WALLET', referenceId: tx.id },
        );
      }

      return tx;
    } catch (error) {
      if (
        isSerializationFailure(error) &&
        attempt < MAX_SERIALIZATION_RETRIES
      ) {
        return this.writeLedgerEntry(
          userId,
          type,
          amount,
          description,
          opts,
          attempt + 1,
        );
      }

      throw error;
    }
  }

  /**
   * Mixed-payment entry point (C9 approved decision: wallet can fully or partially pay for
   * orders). Debits the requested amount (clamped to balance and to the order's remaining
   * payable amount) and, if that fully covers the order, publishes the same `payment.success`
   * event the Razorpay flow already publishes — reusing OrderPaymentListener's existing,
   * idempotent `markOrderPaid` rather than duplicating that transition logic here.
   */
  async applyToOrder(
    userId: string,
    orderId: string,
    requestedAmount: number,
  ): Promise<ApplyWalletToOrderResponseDto> {
    const order = await this.walletRepository.findOrderForWallet(orderId);

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (order.customerId !== userId) {
      throw new ForbiddenException('You do not have access to this order');
    }

    if (order.paymentStatus === 'PAID') {
      throw new BadRequestException('This order has already been paid');
    }

    if (Number(order.walletAmountUsed) > 0) {
      throw new BadRequestException(
        'Wallet has already been applied to this order',
      );
    }

    const totalAmount = Number(order.totalAmount);

    if (requestedAmount <= 0 || requestedAmount > totalAmount) {
      throw new BadRequestException('Invalid wallet amount for this order');
    }

    const balance = await this.walletRepository.getBalance(userId);
    const amountToApply = Math.min(requestedAmount, balance, totalAmount);

    if (amountToApply <= 0) {
      throw new BadRequestException('Insufficient wallet balance');
    }

    await this.writeLedgerEntry(
      userId,
      WalletTransactionType.ORDER_PAYMENT,
      -amountToApply,
      `Applied to order`,
      { orderId },
    );

    await this.walletRepository.setOrderWalletAmount(orderId, amountToApply);

    const remainingAmount = Math.max(
      Math.round((totalAmount - amountToApply) * 100) / 100,
      0,
    );

    if (remainingAmount === 0) {
      await this.eventBus.publish('payment.success', {
        paymentId: null,
        orderId,
      });
    }

    return { walletAmountApplied: amountToApply, remainingAmount };
  }

  /** Consumed by WalletEventListener on `order.status.changed` (DELIVERED) — flat-rate cashback. */
  async creditCashback(
    userId: string,
    orderId: string,
    orderTotal: number,
  ): Promise<void> {
    const amount = Math.round(orderTotal * CASHBACK_RATE * 100) / 100;

    if (amount <= 0) {
      return;
    }

    await this.writeLedgerEntry(
      userId,
      WalletTransactionType.CASHBACK,
      amount,
      'Cashback on your order',
      { orderId },
    );
  }

  /**
   * Consumed by WalletEventListener on `order.status.changed` (DELIVERED). Rewards both sides of
   * a PENDING referral once the referee's order count (including this one) is exactly 1 — i.e.
   * this is genuinely their first completed order, not a re-trigger on a later one.
   */
  async rewardReferralIfEligible(refereeId: string): Promise<void> {
    const referral =
      await this.walletRepository.findReferralByReferee(refereeId);

    if (!referral || referral.status !== 'PENDING') {
      return;
    }

    const deliveredCount =
      await this.walletRepository.countDeliveredOrders(refereeId);

    if (deliveredCount !== 1) {
      return;
    }

    await this.walletRepository.markReferralRewarded(
      referral.id,
      REFERRAL_REWARD_AMOUNT,
    );

    await this.writeLedgerEntry(
      referral.refereeId,
      WalletTransactionType.REFERRAL_REWARD,
      REFERRAL_REWARD_AMOUNT,
      'Referral reward — welcome bonus',
      { referralId: referral.id },
    );

    await this.writeLedgerEntry(
      referral.referrerId,
      WalletTransactionType.REFERRAL_REWARD,
      REFERRAL_REWARD_AMOUNT,
      'Referral reward — your friend placed their first order',
      { referralId: referral.id },
    );

    await this.notificationsService.createNotification(
      referral.referrerId,
      NotificationType.REFERRAL_REWARD,
      'Referral reward earned',
      `You earned ₹${REFERRAL_REWARD_AMOUNT.toFixed(2)} for referring a friend.`,
      { referenceType: 'WALLET', referenceId: referral.id },
    );
  }

  /** Consumed by WalletEventListener on `order.refunded` — credits back the wallet-used portion of a refund. */
  async creditRefund(
    userId: string,
    orderId: string,
    amount: number,
  ): Promise<void> {
    if (amount <= 0) {
      return;
    }

    await this.writeLedgerEntry(
      userId,
      WalletTransactionType.REFUND_CREDIT,
      Math.round(amount * 100) / 100,
      'Refund credited to wallet',
      { orderId },
    );
  }

  async adminAdjustBalance(
    userId: string,
    amount: number,
    reason: string,
  ): Promise<WalletTransactionResponseDto> {
    if (amount === 0) {
      throw new BadRequestException('Adjustment amount cannot be zero');
    }

    const tx = await this.writeLedgerEntry(
      userId,
      WalletTransactionType.ADMIN_ADJUSTMENT,
      amount,
      reason,
    );

    return toTransactionResponse(tx);
  }

  async getAllForAdmin(
    userId: string | undefined,
    page: number,
    limit: number,
  ): Promise<PaginatedAdminWalletTransactionsResponseDto> {
    const skip = (page - 1) * limit;
    const { items, total } = await this.walletRepository.findAllForAdmin({
      userId,
      skip,
      take: limit,
    });

    return {
      items: items.map(
        (tx: WalletTransactionWithUser): AdminWalletTransactionResponseDto => ({
          id: tx.id,
          user: {
            id: tx.user.id,
            firstName: tx.user.firstName,
            lastName: tx.user.lastName ?? undefined,
            email: tx.user.email ?? undefined,
          },
          type: tx.type,
          status: tx.status,
          amount: Number(tx.amount),
          balanceAfter: Number(tx.balanceAfter),
          orderId: tx.orderId ?? undefined,
          description: tx.description,
          createdAt: tx.createdAt,
        }),
      ),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getReferralSummary(
    userId: string,
  ): Promise<ReferralSummaryResponseDto> {
    const [referralCode, summary] = await Promise.all([
      this.walletRepository.findReferralCode(userId),
      this.walletRepository.getReferralSummary(userId),
    ]);

    return { referralCode: referralCode ?? '', ...summary };
  }
}
