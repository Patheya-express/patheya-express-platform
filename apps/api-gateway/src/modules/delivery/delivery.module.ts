import { Module } from '@nestjs/common';

import { DeliveryController } from './controllers/delivery.controller';
import { VehiclesController } from './controllers/vehicles.controller';
import {
  DeliveryDocumentsController,
  AdminDocumentsController,
} from './controllers/documents.controller';
import {
  DeliveryBankAccountController,
  AdminBankAccountController,
} from './controllers/bank-account.controller';
import {
  DeliveryVerificationController,
  AdminVerificationController,
} from './controllers/verification.controller';
import {
  DeliveryOnboardingController,
  AdminOnboardingController,
} from './controllers/onboarding.controller';
import {
  DeliveryComplianceController,
  AdminComplianceController,
} from './controllers/compliance.controller';
import { ProfileController } from './controllers/profile.controller';
import { ProofController } from './controllers/proof.controller';

import { VehiclesService } from './services/vehicles.service';
import { DocumentsService } from './services/documents.service';
import { BankAccountService } from './services/bank-account.service';
import { VerificationService } from './services/verification.service';
import { OnboardingService } from './services/onboarding.service';
import { ComplianceService } from './services/compliance.service';
import { ProfileService } from './services/profile.service';
import { ProofService } from './services/proof.service';

import { VehiclesRepository } from './repositories/vehicles.repository';
import { DocumentsRepository } from './repositories/documents.repository';
import { BankAccountRepository } from './repositories/bank-account.repository';
import { VerificationRepository } from './repositories/verification.repository';
import { ComplianceRepository } from './repositories/compliance.repository';
import { ProofRepository } from './repositories/proof.repository';

import { AuditCoreModule } from '../audit/audit-core.module';
import { NotificationsCoreModule } from '../notifications/notifications-core.module';
// Only needed for PasswordService (Sprint 4.1 — reused to hash/compare proof OTP codes the
// same way user passwords are hashed, rather than adding a second bcrypt wrapper).
import { AuthCoreModule } from '../auth/auth-core.module';
import { OrdersCoreModule } from '../orders/orders-core.module';
import { DeliveryCoreModule } from './delivery-core.module';

/**
 * HTTP-facing half of the delivery feature. `DeliveryService`/`DeliveryRepository`/
 * `OnboardingRepository`/`DeliveryPartnerCreatedOnboardingListener` moved to `DeliveryCoreModule`
 * (the pieces `OrdersCoreModule`/`PresenceModule`/the onboarding listener need); every other
 * sub-feature here (Vehicles, Documents, BankAccount, Verification, Onboarding[Service],
 * Compliance, Profile, Proof) is unchanged — nothing outside this module used them. Neither
 * `PresenceModule` nor `UsersModule` are imported anymore: none of the remaining services here
 * reference `PresenceService`/`UsersService` (only `DeliveryService`, now in Core, did). Re-exports
 * `DeliveryCoreModule` so existing consumers of `DeliveryModule` (`AdminModule`, etc.) keep
 * working unchanged.
 */
@Module({
  imports: [
    AuditCoreModule,
    NotificationsCoreModule,
    AuthCoreModule,
    OrdersCoreModule,
    DeliveryCoreModule,
  ],

  controllers: [
    DeliveryController,
    VehiclesController,
    DeliveryDocumentsController,
    AdminDocumentsController,
    DeliveryBankAccountController,
    AdminBankAccountController,
    DeliveryVerificationController,
    AdminVerificationController,
    DeliveryOnboardingController,
    AdminOnboardingController,
    DeliveryComplianceController,
    AdminComplianceController,
    ProfileController,
    ProofController,
  ],

  providers: [
    VehiclesService,
    VehiclesRepository,
    DocumentsService,
    DocumentsRepository,
    BankAccountService,
    BankAccountRepository,
    VerificationService,
    VerificationRepository,
    OnboardingService,
    ComplianceService,
    ComplianceRepository,
    ProfileService,
    ProofService,
    ProofRepository,
  ],

  exports: [DeliveryCoreModule],
})
export class DeliveryModule {}
