import { randomUUID } from 'crypto';

import {
  AuditAction,
  DeliveryPartnerStatus,
  DeliveryVerificationStage,
  RestaurantStatus,
  RestaurantVerificationStage,
  UserRole,
  VehicleType,
} from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { AppLoggerService } from '../../../infrastructure/logger/logger.service';
import { RestaurantsRepository } from './restaurants.repository';
import { VerificationRepository as RestaurantVerificationRepository } from './verification.repository';
import { DeliveryRepository } from '../../delivery/repositories/delivery.repository';
import { VerificationRepository as DeliveryVerificationRepository } from '../../delivery/repositories/verification.repository';
import { AuditService } from '../../audit/services/audit.service';
import { AuditRepository } from '../../audit/repositories/audit.repository';

/**
 * Sprint 1.9 — real-database concurrency proof for admin state integrity, spanning restaurant
 * status/verification and delivery-partner status/verification/legacy-approval. Mirrors
 * dispatch.repository.concurrency.spec.ts (Sprint 1.7) and refund-integrity.concurrency.spec.ts
 * (Sprint 1.8): every other admin-state spec mocks Prisma entirely, which cannot prove a
 * conditional-updateMany claim actually holds under genuine concurrent load. Runs real
 * `Promise.allSettled`/`Promise.all` batches against a real Postgres connection (same
 * `DATABASE_URL` every other concurrency spec in this codebase assumes). Tested at the repository
 * level — nothing here has retry logic to prove, every claim is a single conditional
 * updateMany/transaction, so the repositories are the real units under test.
 */
describe('Admin state integrity — concurrency (real database)', () => {
  const prisma = new PrismaService({
    warn: () => undefined,
  } as unknown as AppLoggerService);
  const restaurantsRepository = new RestaurantsRepository(prisma);
  const restaurantVerificationRepository = new RestaurantVerificationRepository(
    prisma,
  );
  const deliveryRepository = new DeliveryRepository(prisma);
  const deliveryVerificationRepository = new DeliveryVerificationRepository(
    prisma,
  );
  const auditRepository = new AuditRepository(prisma);
  const auditService = new AuditService(auditRepository);

  const createdUserIds: string[] = [];
  const createdRestaurantIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    if (createdRestaurantIds.length > 0) {
      // RestaurantVerification cascade-deletes with its Restaurant (schema.prisma: onDelete: Cascade).
      await prisma.restaurant.deleteMany({
        where: { id: { in: createdRestaurantIds } },
      });
    }
    if (createdUserIds.length > 0) {
      // DeliveryPartner/DeliveryVerification/VerificationHistory/AuditLog all cascade-delete
      // with their User (schema.prisma: onDelete: Cascade throughout this chain).
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
  });

  async function createAdminUser(): Promise<string> {
    const user = await prisma.user.create({
      data: {
        firstName: 'Concurrency',
        lastName: 'Admin',
        role: UserRole.ADMIN,
      },
    });
    createdUserIds.push(user.id);
    return user.id;
  }

  async function createRestaurant(
    status: RestaurantStatus = RestaurantStatus.PENDING,
  ): Promise<string> {
    const owner = await prisma.user.create({
      data: {
        firstName: 'Concurrency',
        lastName: 'Owner',
        role: UserRole.RESTAURANT_OWNER,
      },
    });
    createdUserIds.push(owner.id);

    const restaurant = await prisma.restaurant.create({
      data: {
        ownerId: owner.id,
        name: 'Concurrency Test Restaurant',
        slug: `concurrency-test-${randomUUID().slice(0, 12)}`,
        status,
      },
    });
    createdRestaurantIds.push(restaurant.id);
    return restaurant.id;
  }

  async function createPartner(
    isVerified = false,
    status: DeliveryPartnerStatus = DeliveryPartnerStatus.OFFLINE,
  ): Promise<string> {
    const user = await prisma.user.create({
      data: {
        firstName: 'Concurrency',
        lastName: 'Partner',
        role: UserRole.DELIVERY_PARTNER,
      },
    });
    createdUserIds.push(user.id);

    const partner = await prisma.deliveryPartner.create({
      data: {
        userId: user.id,
        vehicleType: VehicleType.BIKE,
        vehicleNumber: `CONC-${randomUUID().slice(0, 6).toUpperCase()}`,
        isVerified,
        status,
      },
    });
    return partner.id;
  }

  // =========================================================================================
  // Restaurant status (RestaurantsRepository.claimStatusTransition)
  // =========================================================================================

  describe('Restaurant status', () => {
    it('two admins approve simultaneously: exactly one wins', async () => {
      const restaurantId = await createRestaurant(RestaurantStatus.PENDING);

      const results = await Promise.allSettled([
        restaurantsRepository.claimStatusTransition(
          restaurantId,
          [RestaurantStatus.PENDING],
          RestaurantStatus.APPROVED,
        ),
        restaurantsRepository.claimStatusTransition(
          restaurantId,
          [RestaurantStatus.PENDING],
          RestaurantStatus.APPROVED,
        ),
      ]);

      const winners = results.filter(
        (r) => r.status === 'fulfilled' && r.value.count === 1,
      );
      expect(winners).toHaveLength(1);

      const restaurant = await prisma.restaurant.findUniqueOrThrow({
        where: { id: restaurantId },
      });
      expect(restaurant.status).toBe(RestaurantStatus.APPROVED);
    }, 20000);

    it('twenty admins approve simultaneously: exactly one wins', async () => {
      const restaurantId = await createRestaurant(RestaurantStatus.PENDING);

      const results = await Promise.allSettled(
        Array.from({ length: 20 }, () =>
          restaurantsRepository.claimStatusTransition(
            restaurantId,
            [RestaurantStatus.PENDING],
            RestaurantStatus.APPROVED,
          ),
        ),
      );

      const winners = results.filter(
        (r) => r.status === 'fulfilled' && r.value.count === 1,
      );
      expect(winners).toHaveLength(1);
    }, 20000);

    it('approve races reject: exactly one wins, never both', async () => {
      const restaurantId = await createRestaurant(RestaurantStatus.PENDING);

      const [approveResult, rejectResult] = await Promise.all([
        restaurantsRepository.claimStatusTransition(
          restaurantId,
          [RestaurantStatus.PENDING],
          RestaurantStatus.APPROVED,
        ),
        restaurantsRepository.claimStatusTransition(
          restaurantId,
          [RestaurantStatus.PENDING],
          RestaurantStatus.REJECTED,
        ),
      ]);

      const approveWon = approveResult.count === 1;
      const rejectWon = rejectResult.count === 1;
      expect(approveWon !== rejectWon).toBe(true);

      const restaurant = await prisma.restaurant.findUniqueOrThrow({
        where: { id: restaurantId },
      });
      expect([RestaurantStatus.APPROVED, RestaurantStatus.REJECTED]).toContain(
        restaurant.status,
      );
    }, 20000);

    it('approve races suspend (suspend requires APPROVED, so approve must win first for suspend to ever apply — proves no corrupted intermediate state)', async () => {
      const restaurantId = await createRestaurant(RestaurantStatus.PENDING);

      const [approveResult, suspendResult] = await Promise.all([
        restaurantsRepository.claimStatusTransition(
          restaurantId,
          [RestaurantStatus.PENDING],
          RestaurantStatus.APPROVED,
        ),
        restaurantsRepository.claimStatusTransition(
          restaurantId,
          [RestaurantStatus.APPROVED],
          RestaurantStatus.SUSPENDED,
        ),
      ]);

      // Approve's precondition (PENDING) is met from the initial state, so it always wins.
      expect(approveResult.count).toBe(1);

      // Suspend's precondition (APPROVED) only becomes satisfiable *after* approve actually
      // commits — each claim is its own independent, atomic re-check of the row as it stands at
      // execution time, not a snapshot from before this test started. Whether suspend's
      // updateMany happens to run before or after that commit determines whether it also wins.
      // Both are legitimate, self-consistent sequential outcomes — what matters is the final
      // state is always exactly one of these two, never a corrupted third state.
      const restaurant = await prisma.restaurant.findUniqueOrThrow({
        where: { id: restaurantId },
      });
      if (suspendResult.count === 1) {
        expect(restaurant.status).toBe(RestaurantStatus.SUSPENDED);
      } else {
        expect(restaurant.status).toBe(RestaurantStatus.APPROVED);
      }
    }, 20000);

    it('suspend races restore: each claim independently and atomically re-checks the row, so either a clean single win or a legitimate two-step sequence can occur — never a corrupted state', async () => {
      const restaurantId = await createRestaurant(RestaurantStatus.APPROVED);

      const [suspendResult, restoreResult] = await Promise.all([
        restaurantsRepository.claimStatusTransition(
          restaurantId,
          [RestaurantStatus.APPROVED],
          RestaurantStatus.SUSPENDED,
        ),
        restaurantsRepository.claimStatusTransition(
          restaurantId,
          [RestaurantStatus.SUSPENDED],
          RestaurantStatus.APPROVED,
        ),
      ]);

      // Suspend's precondition (APPROVED) is met from the initial state, so it always wins.
      expect(suspendResult.count).toBe(1);

      // Restore's precondition (SUSPENDED) only becomes satisfiable after suspend's commit — see
      // the "approve races suspend" test above for the full reasoning. Both outcomes here are
      // legitimate; the final state must always match whichever claim actually won last.
      const restaurant = await prisma.restaurant.findUniqueOrThrow({
        where: { id: restaurantId },
      });
      if (restoreResult.count === 1) {
        expect(restaurant.status).toBe(RestaurantStatus.APPROVED);
      } else {
        expect(restaurant.status).toBe(RestaurantStatus.SUSPENDED);
      }
    }, 20000);

    it('duplicate approve request (sequential retry after already approved): second attempt cleanly loses', async () => {
      const restaurantId = await createRestaurant(RestaurantStatus.PENDING);

      const first = await restaurantsRepository.claimStatusTransition(
        restaurantId,
        [RestaurantStatus.PENDING],
        RestaurantStatus.APPROVED,
      );
      expect(first.count).toBe(1);

      const retry = await restaurantsRepository.claimStatusTransition(
        restaurantId,
        [RestaurantStatus.PENDING],
        RestaurantStatus.APPROVED,
      );
      expect(retry.count).toBe(0);
    }, 20000);

    it('audit integrity under concurrency: exactly one audit entry is written, matching the actual final state', async () => {
      const restaurantId = await createRestaurant(RestaurantStatus.PENDING);
      const adminA = await createAdminUser();
      const adminB = await createAdminUser();

      async function attemptApprove(adminUserId: string) {
        const claim = await restaurantsRepository.claimStatusTransition(
          restaurantId,
          [RestaurantStatus.PENDING],
          RestaurantStatus.APPROVED,
        );
        if (claim.count === 1) {
          // Mirrors RestaurantsService.transitionStatus: audit is written only after a won claim.
          await auditService.log(
            adminUserId,
            'Restaurant',
            restaurantId,
            AuditAction.APPROVE,
            { status: RestaurantStatus.PENDING },
            { status: RestaurantStatus.APPROVED },
          );
        }
        return claim;
      }

      await Promise.all([attemptApprove(adminA), attemptApprove(adminB)]);

      const auditEntries = await prisma.auditLog.findMany({
        where: {
          entityType: 'Restaurant',
          entityId: restaurantId,
          action: AuditAction.APPROVE,
        },
      });
      expect(auditEntries).toHaveLength(1);

      const restaurant = await prisma.restaurant.findUniqueOrThrow({
        where: { id: restaurantId },
      });
      // The one audit entry's actor must be whichever admin actually won the claim.
      expect(restaurant.status).toBe(RestaurantStatus.APPROVED);
      expect([adminA, adminB]).toContain(auditEntries[0].userId);
    }, 20000);
  });

  // =========================================================================================
  // Restaurant verification stage (RestaurantVerificationRepository.claimStageTransition)
  // =========================================================================================

  describe('Restaurant verification stage', () => {
    async function createDraftVerification(restaurantId: string) {
      return restaurantVerificationRepository.findOrCreate(restaurantId);
    }

    it('verification races approval: advance-to-APPROVED racing reject — exactly one wins', async () => {
      const restaurantId = await createRestaurant();
      await createDraftVerification(restaurantId);
      await restaurantVerificationRepository.claimStageTransition(
        restaurantId,
        [RestaurantVerificationStage.DRAFT],
        RestaurantVerificationStage.COMPLIANCE_REVIEW,
      );

      const [advanceResult, rejectResult] = await Promise.all([
        restaurantVerificationRepository.claimStageTransition(
          restaurantId,
          [RestaurantVerificationStage.COMPLIANCE_REVIEW],
          RestaurantVerificationStage.APPROVED,
        ),
        restaurantVerificationRepository.claimStageTransition(
          restaurantId,
          [RestaurantVerificationStage.COMPLIANCE_REVIEW],
          RestaurantVerificationStage.REJECTED,
        ),
      ]);

      const advanceWon = advanceResult.count === 1;
      const rejectWon = rejectResult.count === 1;
      expect(advanceWon !== rejectWon).toBe(true);
    }, 20000);

    it('duplicate reject request: second attempt cleanly loses', async () => {
      const restaurantId = await createRestaurant();
      await createDraftVerification(restaurantId);

      const first = await restaurantVerificationRepository.claimStageTransition(
        restaurantId,
        [RestaurantVerificationStage.DRAFT],
        RestaurantVerificationStage.REJECTED,
      );
      expect(first.count).toBe(1);

      const retry = await restaurantVerificationRepository.claimStageTransition(
        restaurantId,
        [RestaurantVerificationStage.DRAFT],
        RestaurantVerificationStage.REJECTED,
      );
      expect(retry.count).toBe(0);
    }, 20000);

    it('restore after already restored (reinstate twice): second attempt cleanly loses', async () => {
      const restaurantId = await createRestaurant();
      await createDraftVerification(restaurantId);
      await restaurantVerificationRepository.claimStageTransition(
        restaurantId,
        [RestaurantVerificationStage.DRAFT],
        RestaurantVerificationStage.APPROVED,
      );
      await restaurantVerificationRepository.claimStageTransition(
        restaurantId,
        [RestaurantVerificationStage.APPROVED],
        RestaurantVerificationStage.SUSPENDED,
      );

      const first = await restaurantVerificationRepository.claimStageTransition(
        restaurantId,
        [RestaurantVerificationStage.SUSPENDED],
        RestaurantVerificationStage.APPROVED,
      );
      expect(first.count).toBe(1);

      const retry = await restaurantVerificationRepository.claimStageTransition(
        restaurantId,
        [RestaurantVerificationStage.SUSPENDED],
        RestaurantVerificationStage.APPROVED,
      );
      expect(retry.count).toBe(0);
    }, 20000);
  });

  // =========================================================================================
  // Delivery partner — legacy isVerified boolean (DeliveryRepository.claimVerification)
  // =========================================================================================

  describe('Delivery partner legacy approve/reject (isVerified)', () => {
    it('two admins approve simultaneously: exactly one wins ("partner cannot become APPROVED twice")', async () => {
      const partnerId = await createPartner(false);

      const results = await Promise.allSettled([
        deliveryRepository.claimVerification(partnerId, false, true),
        deliveryRepository.claimVerification(partnerId, false, true),
      ]);

      const winners = results.filter(
        (r) => r.status === 'fulfilled' && r.value.count === 1,
      );
      expect(winners).toHaveLength(1);

      const partner = await prisma.deliveryPartner.findUniqueOrThrow({
        where: { id: partnerId },
      });
      expect(partner.isVerified).toBe(true);
    }, 20000);

    it('twenty admins approve simultaneously: exactly one wins', async () => {
      const partnerId = await createPartner(false);

      const results = await Promise.allSettled(
        Array.from({ length: 20 }, () =>
          deliveryRepository.claimVerification(partnerId, false, true),
        ),
      );

      const winners = results.filter(
        (r) => r.status === 'fulfilled' && r.value.count === 1,
      );
      expect(winners).toHaveLength(1);
    }, 20000);

    it('approval after already approved: rejected cleanly', async () => {
      const partnerId = await createPartner(true);

      const result = await deliveryRepository.claimVerification(
        partnerId,
        false,
        true,
      );
      expect(result.count).toBe(0);
    }, 20000);

    it('duplicate reject request: second attempt cleanly loses', async () => {
      const partnerId = await createPartner(true);

      const first = await deliveryRepository.claimVerification(
        partnerId,
        true,
        false,
      );
      expect(first.count).toBe(1);

      const retry = await deliveryRepository.claimVerification(
        partnerId,
        true,
        false,
      );
      expect(retry.count).toBe(0);
    }, 20000);
  });

  // =========================================================================================
  // Delivery partner — operational status (DeliveryRepository.claimPartnerStatus)
  // =========================================================================================

  describe('Delivery partner operational status', () => {
    it('duplicate suspend request: second attempt cleanly loses', async () => {
      const partnerId = await createPartner(
        true,
        DeliveryPartnerStatus.AVAILABLE,
      );

      const first = await deliveryRepository.claimPartnerStatus(
        partnerId,
        [
          DeliveryPartnerStatus.OFFLINE,
          DeliveryPartnerStatus.AVAILABLE,
          DeliveryPartnerStatus.ON_DELIVERY,
        ],
        DeliveryPartnerStatus.SUSPENDED,
      );
      expect(first.count).toBe(1);

      const retry = await deliveryRepository.claimPartnerStatus(
        partnerId,
        [
          DeliveryPartnerStatus.OFFLINE,
          DeliveryPartnerStatus.AVAILABLE,
          DeliveryPartnerStatus.ON_DELIVERY,
        ],
        DeliveryPartnerStatus.SUSPENDED,
      );
      expect(retry.count).toBe(0);
    }, 20000);

    it('restore after already restored: second attempt cleanly loses', async () => {
      const partnerId = await createPartner(
        true,
        DeliveryPartnerStatus.SUSPENDED,
      );

      const first = await deliveryRepository.claimPartnerStatus(
        partnerId,
        [DeliveryPartnerStatus.SUSPENDED],
        DeliveryPartnerStatus.OFFLINE,
      );
      expect(first.count).toBe(1);

      const retry = await deliveryRepository.claimPartnerStatus(
        partnerId,
        [DeliveryPartnerStatus.SUSPENDED],
        DeliveryPartnerStatus.OFFLINE,
      );
      expect(retry.count).toBe(0);
    }, 20000);

    it('reject races restore (operational suspend racing restore): suspend always wins first (starting AVAILABLE, only its precondition is initially met); restore may then legitimately win too if it happens to execute after suspend has already committed — a valid two-step sequence, not corruption, since restore is its own independently-atomic claim re-checking the row as it actually is at execution time', async () => {
      const partnerId = await createPartner(
        true,
        DeliveryPartnerStatus.AVAILABLE,
      );

      const [suspendResult, restoreResult] = await Promise.all([
        deliveryRepository.claimPartnerStatus(
          partnerId,
          [
            DeliveryPartnerStatus.OFFLINE,
            DeliveryPartnerStatus.AVAILABLE,
            DeliveryPartnerStatus.ON_DELIVERY,
          ],
          DeliveryPartnerStatus.SUSPENDED,
        ),
        deliveryRepository.claimPartnerStatus(
          partnerId,
          [DeliveryPartnerStatus.SUSPENDED],
          DeliveryPartnerStatus.OFFLINE,
        ),
      ]);

      // Suspend's precondition is met from the initial AVAILABLE state, so it always wins.
      expect(suspendResult.count).toBe(1);

      // Restore's precondition (SUSPENDED) is only satisfiable *after* suspend has actually
      // committed — whether restore's independent updateMany happens to execute before or after
      // that commit determines whether it also wins. Both are legitimate, self-consistent
      // outcomes (no state the row could reach is invalid); what matters is that the final DB
      // state is always exactly one of these two, never a corrupted third state.
      const partner = await prisma.deliveryPartner.findUniqueOrThrow({
        where: { id: partnerId },
      });
      if (restoreResult.count === 1) {
        expect(partner.status).toBe(DeliveryPartnerStatus.OFFLINE);
      } else {
        expect(partner.status).toBe(DeliveryPartnerStatus.SUSPENDED);
      }
    }, 20000);
  });

  // =========================================================================================
  // Delivery partner verification stage — bundled stage + isVerified atomicity
  // (DeliveryVerificationRepository.claimStageTransition)
  // =========================================================================================

  describe('Delivery partner verification stage (bundled with isVerified)', () => {
    async function createDraftVerification(partnerId: string) {
      return deliveryVerificationRepository.findOrCreate(partnerId);
    }

    it('advancing to APPROVED atomically flips isVerified in the same transaction', async () => {
      const partnerId = await createPartner(false);
      await createDraftVerification(partnerId);
      await deliveryVerificationRepository.claimStageTransition({
        deliveryPartnerId: partnerId,
        allowedFromStages: [DeliveryVerificationStage.DRAFT],
        toStage: DeliveryVerificationStage.UNDER_REVIEW,
      });

      const claim = await deliveryVerificationRepository.claimStageTransition({
        deliveryPartnerId: partnerId,
        allowedFromStages: [DeliveryVerificationStage.UNDER_REVIEW],
        toStage: DeliveryVerificationStage.APPROVED,
        isVerifiedUpdate: true,
      });
      expect(claim.count).toBe(1);

      const [verification, partner] = await Promise.all([
        prisma.deliveryVerification.findUniqueOrThrow({
          where: { deliveryPartnerId: partnerId },
        }),
        prisma.deliveryPartner.findUniqueOrThrow({ where: { id: partnerId } }),
      ]);
      expect(verification.stage).toBe(DeliveryVerificationStage.APPROVED);
      expect(partner.isVerified).toBe(true);
    }, 20000);

    it('two admins advance-to-APPROVED simultaneously: exactly one wins, isVerified never double-toggled', async () => {
      const partnerId = await createPartner(false);
      await createDraftVerification(partnerId);
      await deliveryVerificationRepository.claimStageTransition({
        deliveryPartnerId: partnerId,
        allowedFromStages: [DeliveryVerificationStage.DRAFT],
        toStage: DeliveryVerificationStage.UNDER_REVIEW,
      });

      const results = await Promise.allSettled([
        deliveryVerificationRepository.claimStageTransition({
          deliveryPartnerId: partnerId,
          allowedFromStages: [DeliveryVerificationStage.UNDER_REVIEW],
          toStage: DeliveryVerificationStage.APPROVED,
          isVerifiedUpdate: true,
        }),
        deliveryVerificationRepository.claimStageTransition({
          deliveryPartnerId: partnerId,
          allowedFromStages: [DeliveryVerificationStage.UNDER_REVIEW],
          toStage: DeliveryVerificationStage.APPROVED,
          isVerifiedUpdate: true,
        }),
      ]);

      const winners = results.filter(
        (r) => r.status === 'fulfilled' && r.value.count === 1,
      );
      expect(winners).toHaveLength(1);

      const partner = await prisma.deliveryPartner.findUniqueOrThrow({
        where: { id: partnerId },
      });
      expect(partner.isVerified).toBe(true);
    }, 20000);

    it('rejected entities cannot accidentally become ACTIVE: reject (isVerifiedUpdate: false) racing a stale advance-to-APPROVED — only one wins, isVerified always matches the winning stage', async () => {
      const partnerId = await createPartner(false);
      await createDraftVerification(partnerId);
      await deliveryVerificationRepository.claimStageTransition({
        deliveryPartnerId: partnerId,
        allowedFromStages: [DeliveryVerificationStage.DRAFT],
        toStage: DeliveryVerificationStage.UNDER_REVIEW,
      });

      const [approveResult, rejectResult] = await Promise.all([
        deliveryVerificationRepository.claimStageTransition({
          deliveryPartnerId: partnerId,
          allowedFromStages: [DeliveryVerificationStage.UNDER_REVIEW],
          toStage: DeliveryVerificationStage.APPROVED,
          isVerifiedUpdate: true,
        }),
        deliveryVerificationRepository.claimStageTransition({
          deliveryPartnerId: partnerId,
          allowedFromStages: [DeliveryVerificationStage.UNDER_REVIEW],
          toStage: DeliveryVerificationStage.REJECTED,
          isVerifiedUpdate: false,
        }),
      ]);

      const approveWon = approveResult.count === 1;
      const rejectWon = rejectResult.count === 1;
      expect(approveWon !== rejectWon).toBe(true);

      const [verification, partner] = await Promise.all([
        prisma.deliveryVerification.findUniqueOrThrow({
          where: { deliveryPartnerId: partnerId },
        }),
        prisma.deliveryPartner.findUniqueOrThrow({ where: { id: partnerId } }),
      ]);

      // The whole point of bundling: isVerified must always agree with whichever stage actually won.
      if (approveWon) {
        expect(verification.stage).toBe(DeliveryVerificationStage.APPROVED);
        expect(partner.isVerified).toBe(true);
      } else {
        expect(verification.stage).toBe(DeliveryVerificationStage.REJECTED);
        expect(partner.isVerified).toBe(false);
      }
    }, 20000);

    it('a verification history row is written exactly once per won claim, never for a losing one', async () => {
      const partnerId = await createPartner(false);
      await createDraftVerification(partnerId);

      const results = await Promise.allSettled([
        deliveryVerificationRepository.claimStageTransition({
          deliveryPartnerId: partnerId,
          allowedFromStages: [DeliveryVerificationStage.DRAFT],
          toStage: DeliveryVerificationStage.SUBMITTED,
          history: { fromStage: DeliveryVerificationStage.DRAFT },
        }),
        deliveryVerificationRepository.claimStageTransition({
          deliveryPartnerId: partnerId,
          allowedFromStages: [DeliveryVerificationStage.DRAFT],
          toStage: DeliveryVerificationStage.SUBMITTED,
          history: { fromStage: DeliveryVerificationStage.DRAFT },
        }),
      ]);

      const winners = results.filter(
        (r) => r.status === 'fulfilled' && r.value.count === 1,
      );
      expect(winners).toHaveLength(1);

      const history = await prisma.verificationHistory.findMany({
        where: { deliveryPartnerId: partnerId },
      });
      expect(history).toHaveLength(1);
    }, 20000);
  });
});
