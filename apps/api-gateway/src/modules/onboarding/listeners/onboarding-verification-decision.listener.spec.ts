import { OnboardingStatus, RestaurantStatus } from '@prisma/client';

import { OnboardingVerificationDecisionListener } from './onboarding-verification-decision.listener';
import { EventBusService } from '../../../core/events/event-bus.service';

/**
 * Regression coverage for the "approved restaurant stuck on /onboarding/waiting-approval" defect:
 * RestaurantsService.approveRestaurant() (the admin restaurant-management screen's own "Approve"
 * button, PATCH /restaurants/:id/approve — distinct from the verification-stage "Advance" flow)
 * already published 'restaurant.activated', but nothing subscribed to it, so
 * RestaurantOnboarding.status never left SUBMITTED/UNDER_REVIEW even though Restaurant.status was
 * now APPROVED — exactly the mismatch the restaurant-app's onboarding.guard.ts routing decision
 * (resolveDestination) reads to choose /dashboard vs. /onboarding/waiting-approval.
 *
 * Uses the real EventBusService (an in-memory Map with no external dependencies) rather than a
 * mock, so this proves the listener is actually wired up via onModuleInit() and genuinely reacts
 * to the event — not just that its handler logic is correct in isolation.
 */
describe('OnboardingVerificationDecisionListener', () => {
  let eventBus: EventBusService;
  let onboardingRepository: { setStatus: jest.Mock };
  let prisma: { restaurant: { findUnique: jest.Mock } };
  let restaurantsService: { approveRestaurant: jest.Mock };
  let listener: OnboardingVerificationDecisionListener;

  beforeEach(() => {
    eventBus = new EventBusService();
    onboardingRepository = { setStatus: jest.fn().mockResolvedValue(undefined) };
    prisma = { restaurant: { findUnique: jest.fn() } };
    restaurantsService = { approveRestaurant: jest.fn().mockResolvedValue(undefined) };

    listener = new OnboardingVerificationDecisionListener(
      eventBus,
      onboardingRepository as any,
      prisma as any,
      restaurantsService as any,
    );
    listener.onModuleInit();
  });

  describe("'restaurant.activated' (direct admin approve, PATCH /restaurants/:id/approve)", () => {
    it('syncs RestaurantOnboarding.status to APPROVED when the admin approves via the restaurant-management screen', async () => {
      await eventBus.publish('restaurant.activated', { restaurantId: 'restaurant-1' });

      expect(onboardingRepository.setStatus).toHaveBeenCalledWith(
        'restaurant-1',
        OnboardingStatus.APPROVED,
        expect.objectContaining({ decidedAt: expect.any(Date) }),
      );
    });

    it('does not throw or crash the event bus when no onboarding application exists for the restaurant (e.g. seed/admin-created restaurants)', async () => {
      onboardingRepository.setStatus.mockRejectedValueOnce(new Error('no such restaurant'));

      await expect(
        eventBus.publish('restaurant.activated', { restaurantId: 'restaurant-without-onboarding' }),
      ).resolves.toBeUndefined();
    });

    it('does not call RestaurantsService.approveRestaurant() again — this direction never re-triggers the other sync path', async () => {
      await eventBus.publish('restaurant.activated', { restaurantId: 'restaurant-1' });

      expect(restaurantsService.approveRestaurant).not.toHaveBeenCalled();
    });
  });

  describe("'restaurant.verification.completed' (existing verification-stage Advance flow) — unchanged", () => {
    it('still syncs onboarding to APPROVED and cascades to RestaurantsService.approveRestaurant() when the restaurant is still PENDING', async () => {
      prisma.restaurant.findUnique.mockResolvedValue({ status: RestaurantStatus.PENDING });

      await eventBus.publish('restaurant.verification.completed', { restaurantId: 'restaurant-2' });

      expect(onboardingRepository.setStatus).toHaveBeenCalledWith(
        'restaurant-2',
        OnboardingStatus.APPROVED,
        expect.objectContaining({ decidedAt: expect.any(Date) }),
      );
      expect(restaurantsService.approveRestaurant).toHaveBeenCalledWith('restaurant-2', null);
    });

    it('does not re-approve a restaurant that is already APPROVED', async () => {
      prisma.restaurant.findUnique.mockResolvedValue({ status: RestaurantStatus.APPROVED });

      await eventBus.publish('restaurant.verification.completed', { restaurantId: 'restaurant-3' });

      expect(restaurantsService.approveRestaurant).not.toHaveBeenCalled();
    });
  });

  describe("'restaurant.verification.rejected' — unchanged", () => {
    it('syncs onboarding to REJECTED', async () => {
      await eventBus.publish('restaurant.verification.rejected', { restaurantId: 'restaurant-4', reason: 'bad docs' });

      expect(onboardingRepository.setStatus).toHaveBeenCalledWith(
        'restaurant-4',
        OnboardingStatus.REJECTED,
        expect.objectContaining({ decidedAt: expect.any(Date) }),
      );
    });
  });
});
