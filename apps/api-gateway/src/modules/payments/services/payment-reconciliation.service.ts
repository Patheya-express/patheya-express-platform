import { Inject, Injectable, Logger } from '@nestjs/common';

import { PaymentsRepository } from '../repositories/payments.repository';

import { PAYMENT_PROVIDER } from '../constants/payment-provider.constants';

import type { PaymentProvider } from '../providers/payment-provider.interface';

import { PaymentsService } from './payments.service';

import { MetricsService } from '../../metrics/metrics.service';

import { AppLoggerService } from '../../../infrastructure/logger/logger.service';

// Production Readiness Stage C: with up to 100 pending payments per run (PaymentsRepository.
// findPendingPayments' own `take: 100`) and a real Razorpay HTTP round trip per payment, a fully
// sequential loop risked a single run not finishing well inside the 5-minute repeat interval.
// Chunked into small batches rather than one unbounded Promise.all, so this doesn't also risk
// bursting past Razorpay's own per-account rate limit.
const RECONCILIATION_BATCH_SIZE = 8;

@Injectable()
export class PaymentReconciliationService {
  private readonly logger = new Logger(PaymentReconciliationService.name);

  constructor(
    private readonly paymentsRepository: PaymentsRepository,

    @Inject(PAYMENT_PROVIDER)
    private readonly paymentProvider: PaymentProvider,

    private readonly paymentsService: PaymentsService,

    private readonly metrics: MetricsService,

    // Phase 3F-3 (Scheduled Job Observability): additive alongside the pre-existing plain
    // `Logger` above (left untouched, still used for reconcileOne()'s per-payment error log) —
    // used here only for the new scheduled_job_completed/failed events, matching the same
    // structured logger every other scheduled-job event in this codebase already uses.
    private readonly appLogger: AppLoggerService,
  ) {}

  /**
   * Production Readiness Stage D (Observability): without this, PaymentReconciliationProcessor
   * always reported its BullMQ job as "completed" even if every single payment in the sweep
   * failed to reconcile — reconcileOne() catches and only logged per-payment errors, so nothing
   * in Prometheus distinguished "swept 40 payments, resolved 40" from "swept 40 payments, every
   * one errored." recordPaymentReconciliationRun's pendingAfterSweep count makes that visible,
   * mirroring dispatchReconciliationRunsTotal/dispatchOrdersAwaitingAssignment's existing shape
   * for the equivalent dispatch sweep.
   *
   * Phase 3F-3 (Scheduled Job Observability): a per-payment reconcileOne() failure is deliberately
   * NOT a job failure by this existing design (it's caught, counted via pendingAfterSweep above,
   * and the sweep continues) — so scheduled_job_completed below fires on every normal return,
   * including "swept N, resolved 0". scheduled_job_failed is reserved for a true sweep-level
   * throw (e.g. findPendingPayments() itself failing), which did not have any log signal before.
   */
  async reconcilePendingPayments() {
    const startedAt = Date.now();

    try {
      const payments = await this.paymentsRepository.findPendingPayments();

      let resolvedCount = 0;

      for (let i = 0; i < payments.length; i += RECONCILIATION_BATCH_SIZE) {
        const batch = payments.slice(i, i + RECONCILIATION_BATCH_SIZE);

        const outcomes = await Promise.all(
          batch.map((payment) => this.reconcileOne(payment)),
        );

        resolvedCount += outcomes.filter(Boolean).length;
      }

      this.metrics.recordPaymentReconciliationRun(
        payments.length - resolvedCount,
      );

      this.appLogger.log(
        {
          event: 'scheduled_job_completed',
          job: 'payment-reconciliation',
          queue: 'payments',
          durationMs: Date.now() - startedAt,
          resultCount: payments.length,
          resolvedCount,
        },
        'PaymentReconciliationService',
      );
    } catch (error) {
      this.appLogger.error(
        {
          event: 'scheduled_job_failed',
          job: 'payment-reconciliation',
          queue: 'payments',
          durationMs: Date.now() - startedAt,
          reason: error instanceof Error ? error.message : String(error),
        },
        error instanceof Error ? error.stack : undefined,
        'PaymentReconciliationService',
      );

      throw error;
    }
  }

  /** Returns true if the payment was resolved (a captured Razorpay payment was found and
   *  applied), false if it's still pending (no captured payment yet, or the lookup errored). */
  private async reconcileOne(payment: {
    id: string;
    providerOrderId: string | null;
  }): Promise<boolean> {
    try {
      const paymentsResponse = await this.paymentProvider.fetchOrderPayments(
        payment.providerOrderId!,
      );

      const capturedPayment = paymentsResponse.items.find(
        (item) => item.status === 'captured',
      );

      if (!capturedPayment) {
        return false;
      }

      await this.paymentsService.markPaymentSucceededFromReconciliation(
        payment.id,

        capturedPayment.id,
      );

      return true;
    } catch (error) {
      this.metrics.recordPaymentReconciliationError();

      this.logger.error(
        `Payment reconciliation failed for payment ${payment.id}: ${(error as Error)?.message ?? error}`,
        (error as Error)?.stack,
      );

      return false;
    }
  }
}
