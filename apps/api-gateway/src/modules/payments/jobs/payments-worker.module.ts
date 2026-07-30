import { Module } from '@nestjs/common';

import { PaymentReconciliationProcessor } from './payment-reconciliation.processor';

import { PaymentReconciliationBootstrap } from '../services/payment-reconciliation.bootstrap';

import { PaymentReconciliationService } from '../services/payment-reconciliation.service';

import { PaymentsCoreModule } from '../payments-core.module';

/**
 * Worker-only half of the payments feature. Imported solely by `QueueWorkerModule` (never by
 * `AppModule`), so `PaymentReconciliationProcessor` and its repeatable-job bootstrap only run in
 * the dedicated worker process. Depends on `PaymentsCoreModule` for `PaymentsService`/
 * `PaymentsRepository`/`RazorpayProvider` rather than duplicating them.
 */
@Module({
  imports: [PaymentsCoreModule],

  providers: [
    PaymentReconciliationService,
    PaymentReconciliationProcessor,
    PaymentReconciliationBootstrap,
  ],
})
export class PaymentsWorkerModule {}
