import { Module, forwardRef } from '@nestjs/common';

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

import { DeliveryService } from './services/delivery.service';
import { VehiclesService } from './services/vehicles.service';
import { DocumentsService } from './services/documents.service';
import { BankAccountService } from './services/bank-account.service';
import { VerificationService } from './services/verification.service';
import { OnboardingService } from './services/onboarding.service';
import { ComplianceService } from './services/compliance.service';
import { ProfileService } from './services/profile.service';
import { ProofService } from './services/proof.service';

import { DeliveryRepository } from './repositories/delivery.repository';
import { VehiclesRepository } from './repositories/vehicles.repository';
import { DocumentsRepository } from './repositories/documents.repository';
import { BankAccountRepository } from './repositories/bank-account.repository';
import { VerificationRepository } from './repositories/verification.repository';
import { OnboardingRepository } from './repositories/onboarding.repository';
import { ComplianceRepository } from './repositories/compliance.repository';
import { ProofRepository } from './repositories/proof.repository';

import { DeliveryPartnerCreatedOnboardingListener } from './listeners/delivery-partner-created-onboarding.listener';

import { PresenceModule } from '../presence/presence.module';
import { UsersModule } from '../users/users.module';
import { OrdersModule } from '../orders/orders.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    forwardRef(() => PresenceModule),
    UsersModule,
    forwardRef(() => OrdersModule),
    AuditModule,
    NotificationsModule,
    // Only needed for PasswordService (Sprint 4.1 — reused to hash/compare proof OTP codes the
    // same way user passwords are hashed, rather than adding a second bcrypt wrapper).
    AuthModule,
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
    DeliveryService,
    DeliveryRepository,
    VehiclesService,
    VehiclesRepository,
    DocumentsService,
    DocumentsRepository,
    BankAccountService,
    BankAccountRepository,
    VerificationService,
    VerificationRepository,
    OnboardingService,
    OnboardingRepository,
    ComplianceService,
    ComplianceRepository,
    ProfileService,
    ProofService,
    ProofRepository,
    DeliveryPartnerCreatedOnboardingListener,
  ],

  // DeliveryRepository is additionally exported (previously private to this module) so
  // AdminDispatchService (admin/bootstrap-adjacent manual-assignment feature) can reuse its
  // existing admin search/pagination/stats/location queries directly rather than duplicating
  // them — no existing behavior changes, this only widens what's importable.
  exports: [DeliveryService, DeliveryRepository],
})
export class DeliveryModule {}
