import { Injectable } from '@nestjs/common';

import { TransactionStatus } from '@prisma/client';

import { PaymentsRepository } from '../repositories/payments.repository';

import { RazorpayProvider } from '../providers/razorpay.provider';

@Injectable()
export class PaymentReconciliationService {
  constructor(
    private readonly paymentsRepository: PaymentsRepository,

    private readonly razorpayProvider: RazorpayProvider,
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

        await this.paymentsRepository.updatePaymentStatus(
          payment.id,

          TransactionStatus.SUCCESS,

          capturedPayment.id,
        );
      } catch (error) {
        console.error('Payment reconciliation failed', payment.id, error);
      }
    }
  }
}
