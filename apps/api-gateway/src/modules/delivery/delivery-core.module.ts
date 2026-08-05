import { Module, forwardRef } from '@nestjs/common';

import { DeliveryService } from './services/delivery.service';

import { DeliveryRepository } from './repositories/delivery.repository';

import { OnboardingRepository } from './repositories/onboarding.repository';

import { DeliveryPartnerCreatedOnboardingListener } from './listeners/delivery-partner-created-onboarding.listener';

import { PresenceCoreModule } from '../presence/presence-core.module';
import { UsersCoreModule } from '../users/users-core.module';
import { AuditCoreModule } from '../audit/audit-core.module';
import { OrdersCoreModule } from '../orders/orders-core.module';

/**
 * Controller-free core of the delivery feature — `DeliveryService`/`DeliveryRepository` (needed
 * by `OrdersCoreModule`, `PresenceModule`'s controller, and `OrdersService` via a genuine mutual
 * dependency: `OrdersService` needs `DeliveryService` and vice versa, hence `forwardRef` in both
 * directions), plus `OnboardingRepository`/`DeliveryPartnerCreatedOnboardingListener` (the
 * listener needs the repository, and both were already running in the Worker process before this
 * split). The other dozen delivery sub-features (Vehicles, Documents, BankAccount, Verification,
 * Onboarding[Service], Compliance, Profile, Proof) stay in `DeliveryModule` — nothing outside that
 * module used them, so there's no reason to move them.
 */
@Module({
  imports: [
    PresenceCoreModule,
    UsersCoreModule,
    forwardRef(() => OrdersCoreModule),
    AuditCoreModule,
  ],

  providers: [
    DeliveryService,
    DeliveryRepository,
    OnboardingRepository,
    DeliveryPartnerCreatedOnboardingListener,
  ],

  exports: [DeliveryService, DeliveryRepository, OnboardingRepository],
})
export class DeliveryCoreModule {}
