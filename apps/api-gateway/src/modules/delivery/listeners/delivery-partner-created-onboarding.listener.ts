import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { EventBusService } from '../../../core/events/event-bus.service';

import { OnboardingRepository } from '../repositories/onboarding.repository';

/**
 * Initializes the mandatory onboarding record the moment a delivery partner is created —
 * reacts to the 'delivery.created' event (published by DeliveryService.onboardPartner) rather
 * than modifying that service to know about onboarding directly. Exact mirror of
 * OnboardingRestaurantCreatedListener.
 */
@Injectable()
export class DeliveryPartnerCreatedOnboardingListener implements OnModuleInit {
  private readonly logger = new Logger(
    DeliveryPartnerCreatedOnboardingListener.name,
  );

  constructor(
    private readonly eventBus: EventBusService,
    private readonly onboardingRepository: OnboardingRepository,
  ) {}

  onModuleInit() {
    this.eventBus.subscribe('delivery.created', async (event) => {
      try {
        await this.onboardingRepository.findOrCreate(event.deliveryPartnerId);
      } catch (error) {
        this.logger.error(
          `Failed to initialize onboarding for delivery partner ${event.deliveryPartnerId}: ${
            error instanceof Error ? error.message : error
          }`,
        );
      }
    });
  }
}
