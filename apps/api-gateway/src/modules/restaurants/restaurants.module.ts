import { Module } from '@nestjs/common';

import { RestaurantsController } from './controllers/restaurants.controller';
import { CuisinesController } from './controllers/cuisines.controller';
import { ReviewsController } from './controllers/reviews.controller';
import { BranchesController } from './controllers/branches.controller';
import { StaffController } from './controllers/staff.controller';
import { DocumentsController } from './controllers/documents.controller';
import { TaxProfileController } from './controllers/tax-profile.controller';
import { BankAccountController } from './controllers/bank-account.controller';
import { VerificationController } from './controllers/verification.controller';
import { MediaController } from './controllers/media.controller';
import { ComplianceController } from './controllers/compliance.controller';
import { SettingsController } from './controllers/settings.controller';
import { OperatingHoursController } from './controllers/operating-hours.controller';
import { HolidaysController } from './controllers/holidays.controller';

import { RestaurantsService } from './services/restaurants.service';
import { CuisinesService } from './services/cuisines.service';
import { ReviewsService } from './services/reviews.service';
import { BranchesService } from './services/branches.service';
import { StaffService } from './services/staff.service';
import { DocumentsService } from './services/documents.service';
import { TaxProfileService } from './services/tax-profile.service';
import { BankAccountService } from './services/bank-account.service';
import { VerificationService } from './services/verification.service';
import { MediaService } from './services/media.service';
import { ComplianceService } from './services/compliance.service';
import { SettingsService } from './services/settings.service';
import { OperatingHoursService } from './services/operating-hours.service';
import { HolidaysService } from './services/holidays.service';

import { RestaurantsRepository } from './repositories/restaurants.repository';
import { CuisinesRepository } from './repositories/cuisines.repository';
import { ReviewsRepository } from './repositories/reviews.repository';
import { BranchesRepository } from './repositories/branches.repository';
import { StaffRepository } from './repositories/staff.repository';
import { DocumentsRepository } from './repositories/documents.repository';
import { TaxProfileRepository } from './repositories/tax-profile.repository';
import { BankAccountRepository } from './repositories/bank-account.repository';
import { VerificationRepository } from './repositories/verification.repository';
import { MediaRepository } from './repositories/media.repository';
import { SettingsRepository } from './repositories/settings.repository';
import { OperatingHoursRepository } from './repositories/operating-hours.repository';
import { HolidaysRepository } from './repositories/holidays.repository';

import { OffersModule } from '../offers/offers.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [OffersModule, AuditModule],

  controllers: [
    RestaurantsController,
    CuisinesController,
    ReviewsController,
    BranchesController,
    StaffController,
    DocumentsController,
    TaxProfileController,
    BankAccountController,
    VerificationController,
    MediaController,
    ComplianceController,
    SettingsController,
    OperatingHoursController,
    HolidaysController,
  ],

  providers: [
    RestaurantsService,
    RestaurantsRepository,
    CuisinesService,
    CuisinesRepository,
    ReviewsService,
    ReviewsRepository,
    BranchesService,
    BranchesRepository,
    StaffService,
    StaffRepository,
    DocumentsService,
    DocumentsRepository,
    TaxProfileService,
    TaxProfileRepository,
    BankAccountService,
    BankAccountRepository,
    VerificationService,
    VerificationRepository,
    MediaService,
    MediaRepository,
    ComplianceService,
    SettingsService,
    SettingsRepository,
    OperatingHoursService,
    OperatingHoursRepository,
    HolidaysService,
    HolidaysRepository,
  ],

  exports: [RestaurantsService, CuisinesService, SettingsService],
})
export class RestaurantsModule {}
