import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { EventBusService } from '../../../core/events/event-bus.service';

import { OnboardingRepository } from '../repositories/onboarding.repository';

/**
 * Initializes the mandatory onboarding record the moment a restaurant is created — reacts to
 * the existing 'restaurant.created' event (published by RestaurantsService.createRestaurant,
 * previously with zero subscribers) rather than modifying RestaurantsService itself.
 */
@Injectable()
export class OnboardingRestaurantCreatedListener implements OnModuleInit {
  private readonly logger = new Logger(
    OnboardingRestaurantCreatedListener.name,
  );

  constructor(
    private readonly eventBus: EventBusService,
    private readonly onboardingRepository: OnboardingRepository,
  ) {}

  onModuleInit() {
    this.eventBus.subscribe('restaurant.created', async (event) => {
      try {
        await this.onboardingRepository.findOrCreate(event.restaurantId);
      } catch (error) {
        this.logger.error(
          `Failed to initialize onboarding for restaurant ${event.restaurantId}: ${
            error instanceof Error ? error.message : error
          }`,
        );
      }
    });
  }
}
