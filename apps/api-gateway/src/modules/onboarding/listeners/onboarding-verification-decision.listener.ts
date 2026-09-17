import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { OnboardingStatus, RestaurantStatus } from '@prisma/client';

import { EventBusService } from '../../../core/events/event-bus.service';

import { OnboardingRepository } from '../repositories/onboarding.repository';

import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { RestaurantsService } from '../../restaurants/services/restaurants.service';

/**
 * Keeps RestaurantOnboarding.status in sync with the existing, unchanged
 * RestaurantVerification decision events — this is the "connect them" orchestration ERPH-2B.1
 * authorizes, not a redesign of VerificationService (which still owns the actual decision).
 *
 * On approval, this also closes the previously-documented gap where reaching
 * RestaurantVerificationStage.APPROVED never flipped Restaurant.status — it now calls the
 * existing RestaurantsService.approveRestaurant() so "admin approves the application" is a
 * single action from the admin's perspective, matching the mandatory business rule that a
 * restaurant must never become operational before that approval.
 *
 * Also subscribes to 'restaurant.activated' (published by RestaurantsService.approveRestaurant
 * — the admin restaurant-management screen's own, separate "Approve" action, PATCH
 * /restaurants/:id/approve) for the same reason, in the other direction: that action already
 * flips Restaurant.status to APPROVED, but — being decoupled from RestaurantVerification by the
 * same deliberate design noted on VerificationService — never touched RestaurantOnboarding.status
 * either. Before this, approving a submitted application through that screen left
 * RestaurantOnboarding.status stuck at SUBMITTED/UNDER_REVIEW forever (the event was published
 * but had no subscriber), which the restaurant-app's routing guard
 * (onboarding.guard.ts's resolveDestination — the sole source of truth for where an owner
 * belongs) reads to decide dashboard vs. /onboarding/waiting-approval — so an owner whose
 * restaurant was approved this way stayed stuck on the waiting-approval screen indefinitely.
 */
@Injectable()
export class OnboardingVerificationDecisionListener implements OnModuleInit {
  private readonly logger = new Logger(
    OnboardingVerificationDecisionListener.name,
  );

  constructor(
    private readonly eventBus: EventBusService,
    private readonly onboardingRepository: OnboardingRepository,
    private readonly prisma: PrismaService,
    private readonly restaurantsService: RestaurantsService,
  ) {}

  onModuleInit() {
    this.eventBus.subscribe(
      'restaurant.verification.completed',
      async (event) => {
        try {
          await this.onboardingRepository.setStatus(
            event.restaurantId,
            OnboardingStatus.APPROVED,
            {
              decidedAt: new Date(),
            },
          );

          const restaurant = await this.prisma.restaurant.findUnique({
            where: { id: event.restaurantId },
            select: { status: true },
          });

          if (restaurant?.status === RestaurantStatus.PENDING) {
            await this.restaurantsService.approveRestaurant(
              event.restaurantId,
              null,
            );
          }
        } catch (error) {
          this.logger.error(
            `Failed to sync onboarding approval for restaurant ${event.restaurantId}: ${
              error instanceof Error ? error.message : error
            }`,
          );
        }
      },
    );

    this.eventBus.subscribe(
      'restaurant.verification.rejected',
      async (event) => {
        try {
          await this.onboardingRepository.setStatus(
            event.restaurantId,
            OnboardingStatus.REJECTED,
            {
              decidedAt: new Date(),
            },
          );
        } catch (error) {
          this.logger.error(
            `Failed to sync onboarding rejection for restaurant ${event.restaurantId}: ${
              error instanceof Error ? error.message : error
            }`,
          );
        }
      },
    );

    // The admin restaurant-management screen's own "Approve" action (RestaurantsService.
    // approveRestaurant, PATCH /restaurants/:id/approve) — see this class's own doc comment for
    // why this needs the same sync the verification-completed handler above already does.
    this.eventBus.subscribe('restaurant.activated', async (event) => {
      try {
        await this.onboardingRepository.setStatus(
          event.restaurantId,
          OnboardingStatus.APPROVED,
          {
            decidedAt: new Date(),
          },
        );
      } catch (error) {
        this.logger.error(
          `Failed to sync onboarding approval for restaurant ${event.restaurantId} after direct admin approval: ${
            error instanceof Error ? error.message : error
          }`,
        );
      }
    });
  }
}
