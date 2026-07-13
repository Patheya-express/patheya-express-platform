import { Injectable, Logger } from '@nestjs/common';

import { PaymentsRepository } from '../repositories/payments.repository';

import { RazorpayProvider } from '../providers/razorpay.provider';

import { PaymentsService } from './payments.service';

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

    for (const payment of payments) {
      try {
        const paymentsResponse = await this.razorpayProvider.fetchOrderPayments(
          payment.providerOrderId!,
        );

        const capturedPayment = paymentsResponse.items.find(
          (item: any) => item.status === 'captured',
        );

        if (!capturedPayment) {
          continue;
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
}
