import { Injectable, Logger } from '@nestjs/common';

import { PaymentsRepository } from '../repositories/payments.repository';

import { RazorpayProvider } from '../providers/razorpay.provider';

import { PaymentsService } from './payments.service';

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

    private readonly razorpayProvider: RazorpayProvider,

    private readonly paymentsService: PaymentsService,
  ) {}

  async reconcilePendingPayments() {
    const payments = await this.paymentsRepository.findPendingPayments();

    for (let i = 0; i < payments.length; i += RECONCILIATION_BATCH_SIZE) {
      const batch = payments.slice(i, i + RECONCILIATION_BATCH_SIZE);

      await Promise.all(batch.map((payment) => this.reconcileOne(payment)));
    }
  }

  private async reconcileOne(payment: { id: string; providerOrderId: string | null }) {
    try {
      const paymentsResponse = await this.razorpayProvider.fetchOrderPayments(
        payment.providerOrderId!,
      );

      const capturedPayment = paymentsResponse.items.find(
        (item: any) => item.status === 'captured',
      );

      if (!capturedPayment) {
        return;
      }

      await this.paymentsService.markPaymentSucceededFromReconciliation(
        payment.id,

        capturedPayment.id,
      );
    } catch (error) {
      this.logger.error(
        `Payment reconciliation failed for payment ${payment.id}: ${(error as Error)?.message ?? error}`,
        (error as Error)?.stack,
      );
    }
  }
}
