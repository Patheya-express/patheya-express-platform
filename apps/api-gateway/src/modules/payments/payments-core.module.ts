import { Module } from '@nestjs/common';

import { PaymentsService } from './services/payments.service';

import { PaymentsRepository } from './repositories/payments.repository';

import { RazorpayProvider } from './providers/razorpay.provider';

import { PAYMENT_PROVIDER } from './constants/payment-provider.constants';

import { AuditCoreModule } from '../audit/audit-core.module';

/**
 * Controller-free core of the payments feature — `PaymentsService`/`PaymentsRepository`/
 * `RazorpayProvider`, shared as-is (not duplicated) by both `PaymentsModule` (HTTP) and
 * `PaymentsWorkerModule` (`PaymentReconciliationProcessor`, which needs all three). Splitting
 * this out is what lets the worker-side module depend on the payments business logic without
 * also pulling `PaymentsController` into the worker process's HTTP surface. Imports
 * `AuditCoreModule` (controller-free) rather than `AuditModule` for the same reason.
 *
 * `PAYMENT_PROVIDER` is the only active-provider wiring point — `useExisting: RazorpayProvider`
 * aliases the already-registered `RazorpayProvider` instance under the abstraction's DI token
 * (same `RazorpayProvider` singleton, not a second instance), so `PaymentsService`/
 * `PaymentReconciliationService` depend on `PaymentProvider` rather than the concrete class. See
 * providers/payment-provider.interface.ts. No runtime provider-selection logic is introduced
 * here — there is exactly one implementation today, matching the storage module's
 * `StorageProviderFactory` convention (`STORAGE_PROVIDER`) only in shape, not in behavior.
 */
@Module({
  imports: [AuditCoreModule],

  providers: [
    PaymentsService,
    PaymentsRepository,
    RazorpayProvider,
    { provide: PAYMENT_PROVIDER, useExisting: RazorpayProvider },
  ],

  exports: [
    PaymentsService,
    PaymentsRepository,
    RazorpayProvider,
    PAYMENT_PROVIDER,
  ],
})
export class PaymentsCoreModule {}
