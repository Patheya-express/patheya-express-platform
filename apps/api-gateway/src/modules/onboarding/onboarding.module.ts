import { Module } from '@nestjs/common';

import { OnboardingController } from './controllers/onboarding.controller';

import { OnboardingService } from './services/onboarding.service';

import { OnboardingRepository } from './repositories/onboarding.repository';

import { OnboardingRestaurantCreatedListener } from './listeners/onboarding-restaurant-created.listener';
import { OnboardingVerificationDecisionListener } from './listeners/onboarding-verification-decision.listener';

import { RestaurantsModule } from '../restaurants/restaurants.module';
import { AuditModule } from '../audit/audit.module';

/**
 * Orchestrates the mandatory onboarding wizard on top of RestaurantsModule (restaurants,
 * branches, staff, documents, tax profile, bank account, verification, settings, media) — see
 * OnboardingService's own doc comment. No domain logic is duplicated here.
 */
@Module({
  imports: [RestaurantsModule, AuditModule],

  controllers: [OnboardingController],

  providers: [
    OnboardingService,
    OnboardingRepository,
    OnboardingRestaurantCreatedListener,
    OnboardingVerificationDecisionListener,
  ],

  exports: [OnboardingService],
})
export class OnboardingModule {}
