import { Module } from '@nestjs/common';

import { PaymentsController } from './controllers/payments.controller';

import { PaymentsService } from './services/payments.service';

import { PaymentsRepository } from './repositories/payments.repository';

import { RazorpayProvider } from './providers/razorpay.provider';
import { PaymentReconciliationBootstrap } from './services/payment-reconciliation.bootstrap';
import { PaymentReconciliationService } from './services/payment-reconciliation.service';
import { PaymentReconciliationProcessor } from './jobs/payment-reconciliation.processor';
import { AuditModule } from '../audit/audit.module';
@Module({
  imports: [AuditModule],

  controllers: [PaymentsController],

  providers: [
    PaymentsService,

    PaymentsRepository,

    RazorpayProvider,

    PaymentReconciliationBootstrap,

    PaymentReconciliationService,

    PaymentReconciliationProcessor,
  ],

  exports: [PaymentsService],
})
export class PaymentsModule {}
