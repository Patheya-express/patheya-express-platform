import { Module } from '@nestjs/common';

import { PaymentsService } from './services/payments.service';

import { PaymentsRepository } from './repositories/payments.repository';

import { RazorpayProvider } from './providers/razorpay.provider';

import { AuditCoreModule } from '../audit/audit-core.module';

/**
 * Controller-free core of the payments feature — `PaymentsService`/`PaymentsRepository`/
 * `RazorpayProvider`, shared as-is (not duplicated) by both `PaymentsModule` (HTTP) and
 * `PaymentsWorkerModule` (`PaymentReconciliationProcessor`, which needs all three). Splitting
 * this out is what lets the worker-side module depend on the payments business logic without
 * also pulling `PaymentsController` into the worker process's HTTP surface. Imports
 * `AuditCoreModule` (controller-free) rather than `AuditModule` for the same reason.
 */
@Module({
  imports: [AuditCoreModule],

  providers: [PaymentsService, PaymentsRepository, RazorpayProvider],

  exports: [PaymentsService, PaymentsRepository, RazorpayProvider],
})
export class PaymentsCoreModule {}
