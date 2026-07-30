import { Module } from '@nestjs/common';

import { PaymentsController } from './controllers/payments.controller';

import { PaymentsCoreModule } from './payments-core.module';

/**
 * HTTP-facing half of the payments feature — controller only. Business logic
 * (`PaymentsService`/`PaymentsRepository`/`RazorpayProvider`) lives in `PaymentsCoreModule`,
 * shared with `PaymentsWorkerModule` rather than duplicated. `PaymentReconciliationProcessor`/
 * `PaymentReconciliationBootstrap`/`PaymentReconciliationService` moved to `PaymentsWorkerModule`
 * (imported only by the worker process) so this module — and the API process that imports it —
 * no longer instantiates a BullMQ Worker.
 *
 * Re-exports the whole `PaymentsCoreModule` (rather than the bare `PaymentsService` token) since
 * Nest only allows exporting a provider that's declared directly in this module's own
 * `providers` — `PaymentsService` isn't; it lives in the imported `PaymentsCoreModule`. This is
 * what lets `OrdersModule` keep getting `PaymentsService` from importing `PaymentsModule`,
 * unchanged from before this split.
 */
@Module({
  imports: [PaymentsCoreModule],

  controllers: [PaymentsController],

  exports: [PaymentsCoreModule],
})
export class PaymentsModule {}
