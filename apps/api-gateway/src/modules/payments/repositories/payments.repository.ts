import { Injectable } from '@nestjs/common';

import {
  TransactionStatus,
  PaymentProvider,
  PaymentMethod,
  Prisma,
  type Payment,
  type Refund,
} from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

type TransactionClient = Prisma.TransactionClient;

/** Amounts within a paisa of each other are treated as equal — same tolerance PaymentsService
 *  already uses for the analogous provider-amount comparison. */
const AMOUNT_TOLERANCE = 0.01;

/** Discriminated result of claimRefund — every "can't claim" case is a normal, expected outcome
 *  (duplicate browser retry, a concurrent admin click, an already-refunded payment, a bad
 *  amount), never a generic exception; PaymentsService.refundPayment maps each reason to the
 *  right HTTP error. */
export type ClaimRefundResult =
  | { claimed: true; payment: Payment; refund: Refund }
  | {
      claimed: false;
      reason:
        | 'not_found'
        | 'not_success'
        | 'already_refunded'
        | 'invalid_amount'
        | 'refund_in_progress';
    };

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export interface AdminPaymentFilterParams {
  search?: string;
  status?: TransactionStatus;
  provider?: PaymentProvider;
  method?: PaymentMethod;
  dateFrom?: string;
  dateTo?: string;
}

@Injectable()
export class PaymentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createPayment(data: any) {
    return this.prisma.payment.create({
      data,
    });
  }

  async findById(id: string) {
    return this.prisma.payment.findUnique({
      where: {
        id,
      },
    });
  }

  async findByProviderOrderId(providerOrderId: string) {
    return this.prisma.payment.findUnique({
      where: {
        providerOrderId,
      },
    });
  }

  /** Same lookup, plus the order's customerId — used only by the client-driven verify endpoint,
   *  which (unlike the webhook) has an authenticated caller whose identity must be checked
   *  against the order being verified. */
  async findByProviderOrderIdWithOwner(providerOrderId: string) {
    return this.prisma.payment.findUnique({
      where: {
        providerOrderId,
      },
      include: {
        order: {
          select: {
            customerId: true,
          },
        },
      },
    });
  }

  async findLatestAttempt(orderId: string) {
    return this.prisma.payment.findFirst({
      where: {
        orderId,
      },
      orderBy: {
        attemptNumber: 'desc',
      },
    });
  }

  async findActivePaymentForOrder(orderId: string) {
    return this.prisma.payment.findFirst({
      where: {
        orderId,
        isActive: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async deactivateOrderAttempts(orderId: string) {
    return this.prisma.payment.updateMany({
      where: {
        orderId,
        isActive: true,
      },
      data: {
        isActive: false,
      },
    });
  }

  async updatePaymentStatus(
    paymentId: string,
    status: any,
    providerPaymentId?: string,
    method?: PaymentMethod,
  ) {
    return this.prisma.payment.update({
      where: {
        id: paymentId,
      },
      data: {
        status,
        providerPaymentId,
        ...(method ? { method } : {}),
      },
    });
  }

  /**
   * The atomic claim behind every payment status transition (see
   * PaymentsService.transitionPaymentStatus / payment-state-machine.ts's
   * getAllowedSourceStatuses doc comment for the full reasoning). `updateMany`'s `WHERE status IN
   * (...)` is evaluated and applied by Postgres as a single atomic statement — two concurrent
   * callers racing to transition the same payment (e.g. the client's verify call and Razorpay's
   * webhook both reporting the same capture) can never both succeed: whichever commits first
   * changes the row's status out of the allowed set, so the second one's `WHERE` no longer
   * matches and it legitimately affects zero rows. No SELECT ... FOR UPDATE, advisory lock, or
   * SERIALIZABLE isolation needed — a plain conditional UPDATE already serializes at the
   * row-lock level regardless of isolation level.
   */
  async claimStatusTransition(
    paymentId: string,
    allowedFromStatuses: TransactionStatus[],
    nextStatus: TransactionStatus,
    providerPaymentId?: string,
    method?: PaymentMethod,
  ): Promise<{ count: number }> {
    return this.prisma.payment.updateMany({
      where: {
        id: paymentId,
        status: { in: allowedFromStatuses },
      },
      data: {
        status: nextStatus,
        ...(providerPaymentId ? { providerPaymentId } : {}),
        ...(method ? { method } : {}),
      },
    });
  }

  /**
   * Sprint 1.8 — the refund analog of claimStatusTransition, closing "refund claims payment
   * AFTER calling Razorpay" (the payment-status pre-check used to be a plain read, so two
   * concurrent refundPayment calls could both pass it and both reach Razorpay before either
   * transitioned the row). This must run — and commit — BEFORE any external Razorpay call, not
   * after, which rules out flipping Payment.status straight to the terminal REFUNDED here: if the
   * Razorpay call subsequently fails, REFUNDED has no outgoing transition
   * (payment-state-machine.ts), so the payment could never be retried. Instead this claims the
   * *Refund* row itself as the exactly-once gate — Refund.status already defaults to PENDING in
   * the schema but was never actually used as a real state before (createRefund used to insert it
   * pre-completed, as `REFUNDED`, purely as an after-the-fact ledger entry). Reusing that existing
   * column as a genuine two-phase claim needs no schema change.
   *
   * Same pg_advisory_xact_lock philosophy as CouponsRepository.reserveRedemption /
   * DispatchRepository.createAssignmentForOrder: two concurrent claims for the same payment both
   * reading "no refund in progress" before either has inserted one is a phantom-read race no
   * conditional UPDATE alone can catch (there's no row yet to condition on) — the lock, held only
   * for this short claim transaction, serializes that specific check-then-insert. Amount
   * validation (positive, not exceeding the payment) lives here too — the authoritative check,
   * regardless of what the DTO layer already validated — because it must be resolved before the
   * claim succeeds, not after Razorpay has already been called with a bad number.
   */
  async claimRefund(params: {
    paymentId: string;
    amount: number;
  }): Promise<ClaimRefundResult> {
    return this.prisma.$transaction(async (tx: TransactionClient) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${params.paymentId}))`;

      const payment = await tx.payment.findUnique({
        where: { id: params.paymentId },
      });

      if (!payment) {
        return { claimed: false, reason: 'not_found' } as const;
      }

      // Checked ahead of the generic "not SUCCESS" case so an already-refunded payment gets its
      // own accurate reason/error message ("already refunded") rather than the more confusing
      // "only successful payments can be refunded" (payment-state-machine.ts: REFUNDED is
      // terminal, reached only via a completed refund, so this branch specifically means "someone
      // already finished refunding this").
      if (payment.status === TransactionStatus.REFUNDED) {
        return { claimed: false, reason: 'already_refunded' } as const;
      }

      if (payment.status !== TransactionStatus.SUCCESS) {
        return { claimed: false, reason: 'not_success' } as const;
      }

      if (
        params.amount <= 0 ||
        params.amount > Number(payment.amount) + AMOUNT_TOLERANCE
      ) {
        return { claimed: false, reason: 'invalid_amount' } as const;
      }

      // Payment.status is still SUCCESS at this point (not yet REFUNDED, checked above), so an
      // existing PENDING Refund row here means another claim is currently in flight (claimed,
      // Razorpay call not yet finalized) — not "already completed", which the check above already
      // caught.
      const activeRefund = await tx.refund.findFirst({
        where: {
          paymentId: params.paymentId,

          status: TransactionStatus.PENDING,
        },

        select: { id: true },
      });

      if (activeRefund) {
        return { claimed: false, reason: 'refund_in_progress' } as const;
      }

      const refund = await tx.refund.create({
        data: {
          paymentId: params.paymentId,

          amount: params.amount,

          status: TransactionStatus.PENDING,
        },
      });

      return { claimed: true, payment, refund } as const;
    });
  }

  /**
   * Finalizes a successful Razorpay refund — bundles the Payment SUCCESS→REFUNDED claim and the
   * Refund PENDING→REFUNDED claim into one transaction, same "paired claim" philosophy as
   * DispatchRepository.acceptAssignmentAtomic — but unlike that method's three *independent*
   * claims (which are legitimately allowed to succeed/fail together since nothing else can act
   * on the same rows meanwhile), the Refund claim here is made FIRST and the Payment claim is
   * only attempted if it wins. That ordering matters: this codebase has no genuine concurrent
   * "finalize the same refund attempt" caller in production (there is exactly one call site,
   * refundPayment's own sequential success path), but a real-database concurrency test proved
   * that claiming both independently — as an earlier draft of this method did — leaves a
   * corrupted mixed state (Payment REFUNDED, Refund FAILED) if this ever DOES race a concurrent
   * finalizeRefundFailure. Gating the Payment claim on the Refund claim's own success makes that
   * structurally impossible instead of merely unlikely.
   */
  async finalizeRefundSuccess(
    paymentId: string,
    refundId: string,
    providerPaymentId?: string,
  ): Promise<{ paymentClaimCount: number; refundClaimCount: number }> {
    return this.prisma.$transaction(async (tx: TransactionClient) => {
      const refundClaim = await tx.refund.updateMany({
        where: { id: refundId, status: TransactionStatus.PENDING },

        data: { status: TransactionStatus.REFUNDED },
      });

      if (refundClaim.count === 0) {
        // Lost the race to a concurrent finalize (e.g. finalizeRefundFailure) — this Refund row
        // is no longer PENDING, so Payment must not be touched either.
        return { paymentClaimCount: 0, refundClaimCount: 0 };
      }

      const paymentClaim = await tx.payment.updateMany({
        where: { id: paymentId, status: TransactionStatus.SUCCESS },

        data: {
          status: TransactionStatus.REFUNDED,

          ...(providerPaymentId ? { providerPaymentId } : {}),
        },
      });

      return {
        paymentClaimCount: paymentClaim.count,

        refundClaimCount: refundClaim.count,
      };
    });
  }

  /** The retryable-failure counterpart — Payment.status is deliberately left untouched (still
   *  SUCCESS), so a later retry's claimRefund can claim it again once this Refund row is FAILED
   *  (claimRefund's "active refund" check only excludes PENDING/REFUNDED, not FAILED). */
  async finalizeRefundFailure(refundId: string): Promise<{ count: number }> {
    return this.prisma.refund.updateMany({
      where: { id: refundId, status: TransactionStatus.PENDING },

      data: { status: TransactionStatus.FAILED },
    });
  }

  async createWebhookEvent(data: any) {
    return this.prisma.webhookEvent.create({
      data,
    });
  }
  async findByProviderPaymentId(providerPaymentId: string) {
    return this.prisma.payment.findFirst({
      where: {
        providerPaymentId,
      },
    });
  }
  async markWebhookProcessed(webhookId: string) {
    return this.prisma.webhookEvent.update({
      where: {
        id: webhookId,
      },

      data: {
        processed: true,
      },
    });
  }
  async findPendingPayments() {
    return this.prisma.payment.findMany({
      where: {
        status: 'PENDING',

        providerOrderId: {
          not: null,
        },
      },

      take: 100,
    });
  }

  private buildAdminWhere(params: AdminPaymentFilterParams): any {
    const where: any = {};

    if (params.status) {
      where.status = params.status;
    }

    if (params.provider) {
      where.provider = params.provider;
    }

    if (params.method) {
      where.method = params.method;
    }

    if (params.dateFrom || params.dateTo) {
      where.createdAt = {
        ...(params.dateFrom ? { gte: new Date(params.dateFrom) } : {}),

        ...(params.dateTo ? { lte: new Date(params.dateTo) } : {}),
      };
    }

    if (params.search) {
      where.OR = [
        { providerOrderId: { contains: params.search, mode: 'insensitive' } },
        { providerPaymentId: { contains: params.search, mode: 'insensitive' } },
        {
          order: {
            orderNumber: { contains: params.search, mode: 'insensitive' },
          },
        },
        {
          order: {
            customer: {
              firstName: { contains: params.search, mode: 'insensitive' },
            },
          },
        },
        {
          order: {
            customer: {
              lastName: { contains: params.search, mode: 'insensitive' },
            },
          },
        },
        {
          order: {
            customer: {
              email: { contains: params.search, mode: 'insensitive' },
            },
          },
        },
        {
          order: {
            customer: {
              phone: { contains: params.search, mode: 'insensitive' },
            },
          },
        },
      ];
    }

    return where;
  }

  /**
   * Platform-wide, filterable payment listing for admin use. Joins through to the order and
   * its customer (two hops — Payment has no direct customer FK) plus the payment's own refund
   * history, none of which the create/verify/refund flows need since they already know the
   * payment they're operating on.
   */
  async findAllForAdmin(
    params: AdminPaymentFilterParams & { skip: number; take: number },
  ): Promise<{ items: any[]; total: number }> {
    const where = this.buildAdminWhere(params);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where,

        skip: params.skip,

        take: params.take,

        orderBy: {
          createdAt: 'desc',
        },

        include: {
          order: {
            include: {
              customer: true,
            },
          },

          refunds: {
            orderBy: {
              createdAt: 'desc',
            },
          },
        },
      }),

      this.prisma.payment.count({
        where,
      }),
    ]);

    return { items, total };
  }

  async sumSuccessfulAmountToday(): Promise<number> {
    const result = await this.prisma.payment.aggregate({
      _sum: {
        amount: true,
      },

      where: {
        status: TransactionStatus.SUCCESS,

        createdAt: {
          gte: startOfToday(),
        },
      },
    });

    return Number(result._sum.amount ?? 0);
  }
}
