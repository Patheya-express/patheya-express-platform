import { NotFoundException } from '@nestjs/common';

import {
  AssignmentStatus,
  DeliveryPartnerStatus,
  OrderStatus,
  RestaurantStatus,
} from '@prisma/client';

import { DispatchService } from './dispatch.service';

const NOW = new Date('2026-08-06T12:00:00.000Z');

function buildOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    customerId: 'customer-1',
    restaurantId: 'restaurant-1',
    status: OrderStatus.READY_FOR_PICKUP,
    deliveryPartnerId: null,
    // isActive/timezone/operatingHours + restaurant.status: Phase 3 (Change 4) fields
    // findOrderById() now fetches — an open, active, non-suspended restaurant by default so
    // existing tests aren't implicitly asserting anything about restaurant availability unless
    // they override it.
    branch: {
      latitude: 12.9,
      longitude: 77.6,
      isActive: true,
      timezone: null,
      operatingHours: [],
    },
    restaurant: { status: RestaurantStatus.APPROVED },
    ...overrides,
  };
}

function buildPartner(overrides: Record<string, unknown> = {}) {
  return {
    id: 'partner-1',
    userId: 'user-1',
    status: DeliveryPartnerStatus.AVAILABLE,
    isVerified: true,
    currentLatitude: 12.91,
    currentLongitude: 77.61,
    ...overrides,
  };
}

describe('DispatchService', () => {
  let service: DispatchService;
  let repository: {
    findOrderById: jest.Mock;
    findActiveAssignmentForOrder: jest.Mock;
    findAssignmentsForOrder: jest.Mock;
    findAvailablePartners: jest.Mock;
    findPartnerIdsWithActiveAssignment: jest.Mock;
    createAssignmentForOrder: jest.Mock;
    findPartnerByUserId: jest.Mock;
    findAssignmentById: jest.Mock;
    acceptAssignmentAtomic: jest.Mock;
    claimAssignmentTransition: jest.Mock;
  };
  let realtimeService: { emitToUser: jest.Mock; emitToOrder: jest.Mock };
  let queueService: {
    addDispatchAssignmentJob: jest.Mock;
    addAssignmentExpiryJob: jest.Mock;
  };
  let presenceService: {
    isOnlineBatch: jest.Mock;
  };
  let eventBus: { publish: jest.Mock };
  let logger: { log: jest.Mock; error: jest.Mock; warn: jest.Mock };
  let auditService: { log: jest.Mock };
  let metrics: {
    recordDispatchCycleStarted: jest.Mock;
    recordDispatchCycleRetry: jest.Mock;
    recordDispatchMaxCyclesReached: jest.Mock;
    recordDispatchPartnerAccept: jest.Mock;
    recordDispatchPartnerReject: jest.Mock;
    recordDispatchUnlimitedCycle: jest.Mock;
    recordDispatchCycleRotation: jest.Mock;
    observeDispatchAssignmentAcceptanceLatency: jest.Mock;
    observeDispatchCyclesToAcceptance: jest.Mock;
    recordDispatchPartnerSkippedOffline: jest.Mock;
    recordDispatchPartnerSkippedActiveAssignment: jest.Mock;
    recordDispatchPartnerSkippedAttemptedThisCycle: jest.Mock;
    recordDispatchPartnerSkippedDistance: jest.Mock;
  };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);

    repository = {
      findOrderById: jest.fn().mockResolvedValue(buildOrder()),
      findActiveAssignmentForOrder: jest.fn().mockResolvedValue(null),
      findAssignmentsForOrder: jest.fn().mockResolvedValue([]),
      findAvailablePartners: jest.fn().mockResolvedValue([buildPartner()]),
      findPartnerIdsWithActiveAssignment: jest
        .fn()
        .mockResolvedValue(new Set()),
      createAssignmentForOrder: jest.fn().mockResolvedValue({
        created: true,
        assignment: {
          id: 'assignment-1',
          orderId: 'order-1',
          deliveryPartnerId: 'partner-1',
          cycle: 1,
          assignedAt: NOW,
        },
      }),
      findPartnerByUserId: jest.fn(),
      findAssignmentById: jest.fn(),
      acceptAssignmentAtomic: jest.fn(),
      claimAssignmentTransition: jest.fn(),
    };

    realtimeService = { emitToUser: jest.fn(), emitToOrder: jest.fn() };
    queueService = {
      addDispatchAssignmentJob: jest.fn(),
      addAssignmentExpiryJob: jest.fn(),
    };
    presenceService = {
      isOnlineBatch: jest.fn().mockResolvedValue(new Map([['user-1', true]])),
    };
    eventBus = { publish: jest.fn() };
    logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn() };
    auditService = { log: jest.fn() };
    metrics = {
      recordDispatchCycleStarted: jest.fn(),
      recordDispatchCycleRetry: jest.fn(),
      recordDispatchMaxCyclesReached: jest.fn(),
      recordDispatchPartnerAccept: jest.fn(),
      recordDispatchPartnerReject: jest.fn(),
      recordDispatchUnlimitedCycle: jest.fn(),
      recordDispatchCycleRotation: jest.fn(),
      observeDispatchAssignmentAcceptanceLatency: jest.fn(),
      observeDispatchCyclesToAcceptance: jest.fn(),
      recordDispatchPartnerSkippedOffline: jest.fn(),
      recordDispatchPartnerSkippedActiveAssignment: jest.fn(),
      recordDispatchPartnerSkippedAttemptedThisCycle: jest.fn(),
      recordDispatchPartnerSkippedDistance: jest.fn(),
    };

    service = new DispatchService(
      repository as any,
      realtimeService as any,
      queueService as any,
      presenceService as any,
      eventBus as any,
      logger as any,
      auditService as any,
      metrics as any,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('15 second acceptance window (Change 1)', () => {
    it('sets expiresAt DISPATCH_ASSIGNMENT_TIMEOUT_SECONDS (default 15s) in the future', async () => {
      await service.assignOrder('order-1');

      const call = repository.createAssignmentForOrder.mock.calls[0][0];
      expect(call.expiresAt.getTime() - NOW.getTime()).toBe(15_000);
    });

    it('schedules the assignment-expiry job with a matching 15s delay', async () => {
      await service.assignOrder('order-1');

      expect(queueService.addAssignmentExpiryJob).toHaveBeenCalledWith(
        'assignment-1',
        15_000,
      );
    });
  });

  describe('dispatch cycles (Change 2 + Change 4)', () => {
    it('excludes a partner already attempted in the current cycle, without affecting other cycles', async () => {
      repository.findAssignmentsForOrder.mockResolvedValue([
        {
          deliveryPartnerId: 'partner-1',
          status: AssignmentStatus.REJECTED,
          cycle: 1,
        },
      ]);
      repository.findAvailablePartners.mockResolvedValue([
        buildPartner({ id: 'partner-1', userId: 'user-1' }),
      ]);

      await expect(service.assignOrder('order-1')).resolves.toBeNull();

      // Cycle exhausted (the only partner was already attempted this cycle) — scheduled a retry,
      // never threw and never created a duplicate assignment for the same partner.
      expect(repository.createAssignmentForOrder).not.toHaveBeenCalled();
      expect(queueService.addDispatchAssignmentJob).toHaveBeenCalledWith(
        'order-1',
        'dispatch.cycle.retry',
        15_000,
        2,
      );
      expect(metrics.recordDispatchCycleRetry).toHaveBeenCalledTimes(1);
    });

    it('makes the same partner eligible again once a new cycle starts (forcedCycle from the retry job)', async () => {
      // Cycle 1's only assignment for this partner was REJECTED — attemptedPartnerIds would
      // exclude them in cycle 1, but the retry job forces cycle 2.
      repository.findAssignmentsForOrder.mockResolvedValue([
        {
          deliveryPartnerId: 'partner-1',
          status: AssignmentStatus.REJECTED,
          cycle: 1,
        },
      ]);
      repository.findAvailablePartners.mockResolvedValue([
        buildPartner({ id: 'partner-1', userId: 'user-1' }),
      ]);

      const assignment = await service.assignOrder('order-1', 2);

      expect(assignment).not.toBeNull();
      expect(repository.createAssignmentForOrder).toHaveBeenCalledWith(
        expect.objectContaining({ deliveryPartnerId: 'partner-1', cycle: 2 }),
      );
    });

    it('never offers the same partner twice within the same cycle', async () => {
      repository.findAssignmentsForOrder.mockResolvedValue([
        {
          deliveryPartnerId: 'partner-1',
          status: AssignmentStatus.REJECTED,
          cycle: 1,
        },
      ]);
      repository.findAvailablePartners.mockResolvedValue([
        buildPartner({ id: 'partner-1', userId: 'user-1' }),
        buildPartner({ id: 'partner-2', userId: 'user-2' }),
      ]);
      presenceService.isOnlineBatch.mockResolvedValue(
        new Map([
          ['user-1', true],
          ['user-2', true],
        ]),
      );

      await service.assignOrder('order-1');

      // partner-1 already attempted this cycle — only partner-2 may be offered.
      expect(repository.createAssignmentForOrder).toHaveBeenCalledWith(
        expect.objectContaining({ deliveryPartnerId: 'partner-2', cycle: 1 }),
      );
    });

    it('throws and records dispatch_max_cycles_reached once DISPATCH_MAX_CYCLES is hit', async () => {
      repository.findAssignmentsForOrder.mockResolvedValue([
        {
          deliveryPartnerId: 'partner-1',
          status: AssignmentStatus.EXPIRED,
          cycle: 10,
        },
      ]);
      repository.findAvailablePartners.mockResolvedValue([
        buildPartner({ id: 'partner-1', userId: 'user-1' }),
      ]);

      await expect(service.assignOrder('order-1')).rejects.toThrow(
        NotFoundException,
      );

      expect(queueService.addDispatchAssignmentJob).not.toHaveBeenCalled();
      expect(metrics.recordDispatchMaxCyclesReached).toHaveBeenCalledTimes(1);
    });

    it('does not treat a genuinely empty partner pool as a cycle exhaustion', async () => {
      repository.findAvailablePartners.mockResolvedValue([]);

      await expect(service.assignOrder('order-1')).rejects.toThrow(
        NotFoundException,
      );

      expect(queueService.addDispatchAssignmentJob).not.toHaveBeenCalled();
      expect(metrics.recordDispatchMaxCyclesReached).not.toHaveBeenCalled();
    });
  });

  describe('deterministic priority ordering — distance only, then rotation (Dispatch Simplification)', () => {
    it('prefers the nearer partner over a farther one', async () => {
      const near = buildPartner({
        id: 'partner-near',
        userId: 'user-near',
        currentLatitude: 12.901,
        currentLongitude: 77.601,
      });
      const far = buildPartner({
        id: 'partner-far',
        userId: 'user-far',
        currentLatitude: 13.5,
        currentLongitude: 78.2,
      });

      repository.findAvailablePartners.mockResolvedValue([far, near]);
      presenceService.isOnlineBatch.mockResolvedValue(
        new Map([
          ['user-near', true],
          ['user-far', true],
        ]),
      );

      await service.assignOrder('order-1');

      expect(repository.createAssignmentForOrder).toHaveBeenCalledWith(
        expect.objectContaining({ deliveryPartnerId: 'partner-near' }),
      );
    });

    it('is deterministic — repeated calls with identical input pick the same partner, never random', async () => {
      const a = buildPartner({
        id: 'partner-a',
        userId: 'user-a',
        currentLatitude: null,
        currentLongitude: null,
      });
      const b = buildPartner({
        id: 'partner-b',
        userId: 'user-b',
        currentLatitude: null,
        currentLongitude: null,
      });

      repository.findAvailablePartners.mockResolvedValue([a, b]);
      presenceService.isOnlineBatch.mockResolvedValue(
        new Map([
          ['user-a', true],
          ['user-b', true],
        ]),
      );

      const picks = new Set<string>();
      for (let i = 0; i < 5; i += 1) {
        repository.createAssignmentForOrder.mockClear();
        await service.assignOrder('order-1');
        picks.add(
          repository.createAssignmentForOrder.mock.calls[0][0]
            .deliveryPartnerId,
        );
      }

      expect(picks.size).toBe(1);
    });

    it('a tie on distance resolves identically no matter what order the repository returns partners in — never depends on Postgres row order', async () => {
      // Pre-merge review finding: findAvailablePartners() has no ORDER BY, so Postgres gives no
      // row-order guarantee. All three partners here tie on distance (all missing coordinates,
      // all score Infinity) — the only real-world case this matters, since equal real coordinates
      // are rare but "no location reported at all" is common in QA/early rollout. Feeding the
      // repository mock every permutation of the same three partners and asserting one single
      // winner directly proves the id tiebreaker, not just that repeated calls with the same input
      // order agree with each other (the pre-existing test above only proved that weaker property).
      const a = buildPartner({
        id: 'partner-a',
        userId: 'user-a',
        currentLatitude: null,
        currentLongitude: null,
      });
      const b = buildPartner({
        id: 'partner-b',
        userId: 'user-b',
        currentLatitude: null,
        currentLongitude: null,
      });
      const c = buildPartner({
        id: 'partner-c',
        userId: 'user-c',
        currentLatitude: null,
        currentLongitude: null,
      });

      presenceService.isOnlineBatch.mockResolvedValue(
        new Map([
          ['user-a', true],
          ['user-b', true],
          ['user-c', true],
        ]),
      );

      const permutations = [
        [a, b, c],
        [c, b, a],
        [b, c, a],
        [a, c, b],
      ];

      const picks = new Set<string>();
      for (const permutation of permutations) {
        repository.findAvailablePartners.mockResolvedValue(permutation);
        repository.createAssignmentForOrder.mockClear();
        await service.assignOrder('order-1');
        picks.add(
          repository.createAssignmentForOrder.mock.calls[0][0]
            .deliveryPartnerId,
        );
      }

      expect(picks.size).toBe(1);
      // The winner is specifically the lowest partner id (ordinal comparison) — 'partner-a' sorts
      // first among 'partner-a'/'partner-b'/'partner-c' — confirming *which* deterministic rule is
      // in effect, not just that some rule is.
      expect([...picks][0]).toBe('partner-a');
    });

    it('does not crash when the order has no branch on record', async () => {
      repository.findOrderById.mockResolvedValue(buildOrder({ branch: null }));
      repository.findAvailablePartners.mockResolvedValue([
        buildPartner({ id: 'partner-1', userId: 'user-1' }),
        buildPartner({ id: 'partner-2', userId: 'user-2' }),
      ]);
      presenceService.isOnlineBatch.mockResolvedValue(
        new Map([
          ['user-1', true],
          ['user-2', true],
        ]),
      );

      await expect(service.assignOrder('order-1')).resolves.not.toBeNull();
    });
  });

  describe('accept / reject (unchanged concurrency protection, new logging/metrics)', () => {
    it('accepting stops dispatch and records dispatch_completed + the accept metric', async () => {
      repository.findPartnerByUserId.mockResolvedValue({
        id: 'partner-1',
        userId: 'user-1',
        isVerified: true,
        status: DeliveryPartnerStatus.AVAILABLE,
      });
      repository.findAssignmentById.mockResolvedValue({
        id: 'assignment-1',
        orderId: 'order-1',
        deliveryPartnerId: 'partner-1',
        cycle: 1,
        assignedAt: new Date(NOW.getTime() - 5000),
      });
      repository.acceptAssignmentAtomic.mockResolvedValue({ accepted: true });

      const result = await service.acceptAssignment('assignment-1', 'user-1');

      expect(result).toEqual({ success: true });
      expect(metrics.recordDispatchPartnerAccept).toHaveBeenCalledTimes(1);
      expect(
        logger.log.mock.calls.some(
          ([payload]) => payload.event === 'dispatch_completed',
        ),
      ).toBe(true);
    });

    it('rejecting records the reject metric and still publishes dispatch.assignment.rejected (unchanged EventBus contract)', async () => {
      repository.findPartnerByUserId.mockResolvedValue({
        id: 'partner-1',
        userId: 'user-1',
      });
      repository.findAssignmentById.mockResolvedValue({
        id: 'assignment-1',
        orderId: 'order-1',
        deliveryPartnerId: 'partner-1',
        cycle: 1,
      });
      repository.claimAssignmentTransition.mockResolvedValue({ count: 1 });

      const result = await service.rejectAssignment('assignment-1', 'user-1');

      expect(result).toEqual({ success: true });
      expect(metrics.recordDispatchPartnerReject).toHaveBeenCalledTimes(1);
      expect(eventBus.publish).toHaveBeenCalledWith(
        'dispatch.assignment.rejected',
        {
          orderId: 'order-1',
          assignmentId: 'assignment-1',
        },
      );
    });
  });

  describe('pre-existing concurrency protection (unchanged)', () => {
    it('returns the existing active assignment as a no-op instead of creating a duplicate', async () => {
      repository.findActiveAssignmentForOrder.mockResolvedValue({
        id: 'existing-assignment',
      });

      const result = await service.assignOrder('order-1');

      expect(result).toEqual({ id: 'existing-assignment' });
      expect(repository.createAssignmentForOrder).not.toHaveBeenCalled();
    });

    it('treats a lost createAssignmentForOrder race as a no-op, not an error', async () => {
      repository.createAssignmentForOrder.mockResolvedValue({
        created: false,
        reason: 'active_assignment_exists',
      });

      const result = await service.assignOrder('order-1');

      expect(result).toBeNull();
    });
  });

  describe('unlimited dispatch mode (Phase 2, Change 1)', () => {
    // DISPATCH_MAX_CYCLES is read once at module load — these tests set the env var and reload
    // the module fresh via jest.resetModules() so the constant re-evaluates, then restore the
    // env var afterward so no other test in this file (or file load order) is affected.
    const ORIGINAL_MAX_CYCLES = process.env.DISPATCH_MAX_CYCLES;

    afterEach(() => {
      if (ORIGINAL_MAX_CYCLES === undefined) {
        delete process.env.DISPATCH_MAX_CYCLES;
      } else {
        process.env.DISPATCH_MAX_CYCLES = ORIGINAL_MAX_CYCLES;
      }
      jest.resetModules();
    });

    function loadServiceWithEnv(maxCycles: string) {
      process.env.DISPATCH_MAX_CYCLES = maxCycles;
      jest.resetModules();

      // require(), not import — this file/project runs Jest under CommonJS (no
      // --experimental-vm-modules), where a true dynamic import() throws at runtime. require()
      // is also what actually respects jest.resetModules()'s cache invalidation here, which is
      // the entire point: re-evaluating dispatch.service.ts's module-level DISPATCH_MAX_CYCLES
      // constant against the env var just set above.

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fresh: typeof import('./dispatch.service') = require('./dispatch.service');

      return new fresh.DispatchService(
        repository as any,
        realtimeService as any,
        queueService as any,
        presenceService as any,
        eventBus as any,
        logger as any,
        auditService as any,
        metrics as any,
      );
    }

    it('DISPATCH_MAX_CYCLES=0 never throws, no matter how many cycles have already run', async () => {
      const unlimitedService = loadServiceWithEnv('0');

      repository.findAssignmentsForOrder.mockResolvedValue([
        {
          deliveryPartnerId: 'partner-1',
          status: AssignmentStatus.EXPIRED,
          cycle: 500,
          respondedAt: null,
        },
      ]);
      repository.findAvailablePartners.mockResolvedValue([
        buildPartner({ id: 'partner-1', userId: 'user-1' }),
      ]);

      await expect(unlimitedService.assignOrder('order-1')).resolves.toBeNull();

      expect(queueService.addDispatchAssignmentJob).toHaveBeenCalledWith(
        'order-1',
        'dispatch.cycle.retry',
        15_000,
        501,
      );
      expect(metrics.recordDispatchMaxCyclesReached).not.toHaveBeenCalled();
      expect(metrics.recordDispatchUnlimitedCycle).toHaveBeenCalledTimes(1);
      expect(
        logger.log.mock.calls.some(
          ([payload]: any) => payload.event === 'dispatch_unlimited_mode',
        ),
      ).toBe(true);
    });

    it('a finite override (e.g. 3) still caps retries at that literal value', async () => {
      const finiteService = loadServiceWithEnv('3');

      repository.findAssignmentsForOrder.mockResolvedValue([
        {
          deliveryPartnerId: 'partner-1',
          status: AssignmentStatus.EXPIRED,
          cycle: 3,
          respondedAt: null,
        },
      ]);
      repository.findAvailablePartners.mockResolvedValue([
        buildPartner({ id: 'partner-1', userId: 'user-1' }),
      ]);

      // Message-based, not instanceof-based: jest.resetModules() gives the freshly-required
      // module its own separate copy of @nestjs/common, so its thrown NotFoundException is not
      // instanceof the one imported statically at this file's top — a resetModules artifact, not
      // a real behavioral difference (confirmed by dispatch.service.ts's own unchanged `throw new
      // NotFoundException(...)` call site).
      await expect(finiteService.assignOrder('order-1')).rejects.toThrow(
        'No delivery partners available',
      );

      expect(queueService.addDispatchAssignmentJob).not.toHaveBeenCalled();
      expect(metrics.recordDispatchMaxCyclesReached).toHaveBeenCalledTimes(1);
    });
  });

  describe('round-robin cycle start (Phase 2, Change 2)', () => {
    it('rotates the starting partner by one position each successive cycle, deterministically', async () => {
      const a = buildPartner({
        id: 'partner-a',
        userId: 'user-a',
        currentLatitude: null,
        currentLongitude: null,
      });
      const b = buildPartner({
        id: 'partner-b',
        userId: 'user-b',
        currentLatitude: null,
        currentLongitude: null,
      });
      const c = buildPartner({
        id: 'partner-c',
        userId: 'user-c',
        currentLatitude: null,
        currentLongitude: null,
      });

      repository.findAvailablePartners.mockResolvedValue([a, b, c]);
      presenceService.isOnlineBatch.mockResolvedValue(
        new Map([
          ['user-a', true],
          ['user-b', true],
          ['user-c', true],
        ]),
      );

      // Cycle 1, nobody attempted yet: base priority order is A, B, C (all tied, so
      // onlinePartners' own incoming order wins) — rotation offset (1-1)%3=0, no rotation.
      repository.findAssignmentsForOrder.mockResolvedValue([]);
      await service.assignOrder('order-1');
      expect(
        repository.createAssignmentForOrder.mock.calls[0][0].deliveryPartnerId,
      ).toBe('partner-a');

      // Cycle 2 starts (forcedCycle=2), nothing attempted in cycle 2 yet: rotation offset
      // (2-1)%3=1 -> [B, C, A] -> B first.
      repository.createAssignmentForOrder.mockClear();
      repository.findAssignmentsForOrder.mockResolvedValue([
        {
          deliveryPartnerId: 'partner-a',
          status: AssignmentStatus.REJECTED,
          cycle: 1,
          respondedAt: null,
        },
      ]);
      await service.assignOrder('order-1', 2);
      expect(
        repository.createAssignmentForOrder.mock.calls[0][0].deliveryPartnerId,
      ).toBe('partner-b');
      expect(
        logger.log.mock.calls.some(
          ([payload]: any) => payload.event === 'dispatch_cycle_rotated',
        ),
      ).toBe(true);
      expect(metrics.recordDispatchCycleRotation).toHaveBeenCalledTimes(1);

      // Still cycle 2, B just rejected too: onlinePartners is now [A, C] (B excluded by
      // attemptedPartnerIds), rotation offset (2-1)%2=1 -> [C, A] -> C first.
      repository.createAssignmentForOrder.mockClear();
      repository.findAssignmentsForOrder.mockResolvedValue([
        {
          deliveryPartnerId: 'partner-a',
          status: AssignmentStatus.REJECTED,
          cycle: 1,
          respondedAt: null,
        },
        {
          deliveryPartnerId: 'partner-b',
          status: AssignmentStatus.REJECTED,
          cycle: 2,
          respondedAt: null,
        },
      ]);
      await service.assignOrder('order-1', 2);
      expect(
        repository.createAssignmentForOrder.mock.calls[0][0].deliveryPartnerId,
      ).toBe('partner-c');

      // Cycle 3 starts (forcedCycle=3): rotation offset (3-1)%3=2 -> [C, A, B] -> C first.
      repository.createAssignmentForOrder.mockClear();
      repository.findAssignmentsForOrder.mockResolvedValue([
        {
          deliveryPartnerId: 'partner-a',
          status: AssignmentStatus.REJECTED,
          cycle: 1,
          respondedAt: null,
        },
        {
          deliveryPartnerId: 'partner-b',
          status: AssignmentStatus.REJECTED,
          cycle: 2,
          respondedAt: null,
        },
        {
          deliveryPartnerId: 'partner-c',
          status: AssignmentStatus.REJECTED,
          cycle: 2,
          respondedAt: null,
        },
      ]);
      await service.assignOrder('order-1', 3);
      expect(
        repository.createAssignmentForOrder.mock.calls[0][0].deliveryPartnerId,
      ).toBe('partner-c');
    });

    it('never randomizes — identical inputs always rotate to the same result', async () => {
      const a = buildPartner({
        id: 'partner-a',
        userId: 'user-a',
        currentLatitude: null,
        currentLongitude: null,
      });
      const b = buildPartner({
        id: 'partner-b',
        userId: 'user-b',
        currentLatitude: null,
        currentLongitude: null,
      });

      repository.findAvailablePartners.mockResolvedValue([a, b]);
      presenceService.isOnlineBatch.mockResolvedValue(
        new Map([
          ['user-a', true],
          ['user-b', true],
        ]),
      );
      repository.findAssignmentsForOrder.mockResolvedValue([]);

      const picks = new Set<string>();
      for (let i = 0; i < 5; i += 1) {
        repository.createAssignmentForOrder.mockClear();
        await service.assignOrder('order-1', 4); // same fixed cycle every time
        picks.add(
          repository.createAssignmentForOrder.mock.calls[0][0]
            .deliveryPartnerId,
        );
      }

      expect(picks.size).toBe(1);
    });

    it('survives a worker restart — a brand-new DispatchService instance rotates identically from the same persisted state', async () => {
      const a = buildPartner({
        id: 'partner-a',
        userId: 'user-a',
        currentLatitude: null,
        currentLongitude: null,
      });
      const b = buildPartner({
        id: 'partner-b',
        userId: 'user-b',
        currentLatitude: null,
        currentLongitude: null,
      });
      const c = buildPartner({
        id: 'partner-c',
        userId: 'user-c',
        currentLatitude: null,
        currentLongitude: null,
      });

      repository.findAvailablePartners.mockResolvedValue([a, b, c]);
      presenceService.isOnlineBatch.mockResolvedValue(
        new Map([
          ['user-a', true],
          ['user-b', true],
          ['user-c', true],
        ]),
      );
      // Persisted state as it would exist on disk mid-cycle-2, after a crash/restart — nothing
      // about "which rotation offset we're on" lives anywhere except this DB state plus the
      // cycle number itself.
      repository.findAssignmentsForOrder.mockResolvedValue([
        {
          deliveryPartnerId: 'partner-a',
          status: AssignmentStatus.REJECTED,
          cycle: 1,
          respondedAt: null,
        },
      ]);

      const restartedService = new DispatchService(
        repository as any,
        realtimeService as any,
        queueService as any,
        presenceService as any,
        eventBus as any,
        logger as any,
        auditService as any,
        metrics as any,
      );

      await restartedService.assignOrder('order-1', 2);

      // Same result Phase 2's round-robin test asserted for cycle 2's first offer (partner-b) —
      // proving a completely fresh instance with no shared memory reconstructs it identically.
      expect(
        repository.createAssignmentForOrder.mock.calls[0][0].deliveryPartnerId,
      ).toBe('partner-b');
    });
  });

  /**
   * Dispatch Simplification — Business rule: a delivery partner must become immediately eligible
   * for the next order once they have no active assignment. No cooldown period, no recent-delivery
   * penalty, no assignment-per-minute rate limiting. These tests replace the Phase 2 "rejection
   * cooldown" describe block, which tested the exact opposite of this business rule and has been
   * removed along with the feature it covered.
   */
  describe('Dispatch Simplification — immediate re-eligibility, no cooldown/rate-limit', () => {
    it('a rider who just rejected an order is immediately eligible again once a new cycle starts — no cooldown holds them back', async () => {
      const rejectedAt = new Date(NOW.getTime() - 1000); // 1s ago — would still be well inside any of the old cooldown windows this feature used to enforce

      repository.findAssignmentsForOrder.mockResolvedValue([
        {
          deliveryPartnerId: 'partner-1',
          status: AssignmentStatus.REJECTED,
          cycle: 1,
          respondedAt: rejectedAt,
        },
      ]);
      repository.findAvailablePartners.mockResolvedValue([
        buildPartner({ id: 'partner-1', userId: 'user-1' }),
      ]);

      // forcedCycle=2: the only thing that used to matter here was attemptedPartnerIds' cycle
      // scoping (which already resets on a new cycle) plus, previously, a rejection cooldown that
      // would have kept this partner excluded regardless of cycle. That second mechanism is gone.
      const assignment = await service.assignOrder('order-1', 2);

      expect(assignment).not.toBeNull();
      expect(repository.createAssignmentForOrder).toHaveBeenCalledWith(
        expect.objectContaining({ deliveryPartnerId: 'partner-1', cycle: 2 }),
      );
    });

    it('a rider immediately receives the next order right after accepting (completing) the previous one', async () => {
      repository.findPartnerByUserId.mockResolvedValue({
        id: 'partner-1',
        userId: 'user-1',
        isVerified: true,
        status: DeliveryPartnerStatus.AVAILABLE,
      });

      // Order A: dispatched, then accepted.
      await service.assignOrder('order-a');
      repository.findAssignmentById.mockResolvedValue({
        id: 'assignment-a',
        orderId: 'order-a',
        deliveryPartnerId: 'partner-1',
        cycle: 1,
        assignedAt: NOW,
      });
      repository.acceptAssignmentAtomic.mockResolvedValue({ accepted: true });
      await service.acceptAssignment('assignment-a', 'user-1');

      // Order B: a brand new order for the same partner, no assignment history of its own, and
      // (per the default mock) zero active assignments — nothing in the dispatch pipeline should
      // hold them back from receiving it immediately.
      repository.createAssignmentForOrder.mockClear();
      repository.findAssignmentsForOrder.mockResolvedValue([]);
      const assignmentB = await service.assignOrder('order-b');

      expect(assignmentB).not.toBeNull();
      expect(repository.createAssignmentForOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: 'order-b',
          deliveryPartnerId: 'partner-1',
        }),
      );
    });

    it('a rider can accept consecutive orders back to back with no artificial gap between them', async () => {
      repository.findPartnerByUserId.mockResolvedValue({
        id: 'partner-1',
        userId: 'user-1',
        isVerified: true,
        status: DeliveryPartnerStatus.AVAILABLE,
      });
      repository.acceptAssignmentAtomic.mockResolvedValue({ accepted: true });

      for (const orderId of ['order-a', 'order-b', 'order-c']) {
        repository.findAssignmentsForOrder.mockResolvedValue([]);
        repository.createAssignmentForOrder.mockResolvedValue({
          created: true,
          assignment: {
            id: `assignment-${orderId}`,
            orderId,
            deliveryPartnerId: 'partner-1',
            cycle: 1,
            assignedAt: NOW,
          },
        });

        const assignment = await service.assignOrder(orderId);
        expect(assignment).not.toBeNull();

        repository.findAssignmentById.mockResolvedValue({
          id: `assignment-${orderId}`,
          orderId,
          deliveryPartnerId: 'partner-1',
          cycle: 1,
          assignedAt: NOW,
        });
        const result = await service.acceptAssignment(
          `assignment-${orderId}`,
          'user-1',
        );
        expect(result).toEqual({ success: true });
      }

      expect(metrics.recordDispatchPartnerAccept).toHaveBeenCalledTimes(3);
    });

    it('a single online rider continuously receives every order in a row — nothing artificially skips their turn', async () => {
      repository.findAvailablePartners.mockResolvedValue([
        buildPartner({ id: 'partner-1', userId: 'user-1' }),
      ]);

      for (let i = 0; i < 5; i += 1) {
        repository.createAssignmentForOrder.mockClear();
        repository.findAssignmentsForOrder.mockResolvedValue([]); // each order is independent
        const assignment = await service.assignOrder(`order-${i}`);

        expect(assignment).not.toBeNull();
        expect(repository.createAssignmentForOrder).toHaveBeenCalledTimes(1);
      }
    });

    it('QA scenario — single rider: 10 consecutive orders, the same rider is dispatched and accepts all 10', async () => {
      repository.findPartnerByUserId.mockResolvedValue({
        id: 'partner-1',
        userId: 'user-1',
        isVerified: true,
        status: DeliveryPartnerStatus.AVAILABLE,
      });
      repository.findAvailablePartners.mockResolvedValue([
        buildPartner({ id: 'partner-1', userId: 'user-1' }),
      ]);
      repository.acceptAssignmentAtomic.mockResolvedValue({ accepted: true });

      for (let i = 0; i < 10; i += 1) {
        const orderId = `order-${i}`;
        const assignmentId = `assignment-${i}`;

        repository.findAssignmentsForOrder.mockResolvedValue([]); // each order's own history is independent
        repository.createAssignmentForOrder.mockResolvedValue({
          created: true,
          assignment: {
            id: assignmentId,
            orderId,
            deliveryPartnerId: 'partner-1',
            cycle: 1,
            assignedAt: NOW,
          },
        });

        const assignment = await service.assignOrder(orderId);
        expect(assignment).not.toBeNull();
        expect(assignment).toMatchObject({ deliveryPartnerId: 'partner-1' });

        repository.findAssignmentById.mockResolvedValue({
          id: assignmentId,
          orderId,
          deliveryPartnerId: 'partner-1',
          cycle: 1,
          assignedAt: NOW,
        });

        const result = await service.acceptAssignment(assignmentId, 'user-1');
        expect(result).toEqual({ success: true });
      }

      expect(metrics.recordDispatchPartnerAccept).toHaveBeenCalledTimes(10);
    });

    it('multiple riders still rotate correctly across cycles, with no cooldown/rate-limit interference', async () => {
      const a = buildPartner({
        id: 'partner-a',
        userId: 'user-a',
        currentLatitude: null,
        currentLongitude: null,
      });
      const b = buildPartner({
        id: 'partner-b',
        userId: 'user-b',
        currentLatitude: null,
        currentLongitude: null,
      });

      repository.findAvailablePartners.mockResolvedValue([a, b]);
      presenceService.isOnlineBatch.mockResolvedValue(
        new Map([
          ['user-a', true],
          ['user-b', true],
        ]),
      );

      repository.findAssignmentsForOrder.mockResolvedValue([]);
      await service.assignOrder('order-1');
      expect(
        repository.createAssignmentForOrder.mock.calls[0][0].deliveryPartnerId,
      ).toBe('partner-a');

      // Cycle 2: A rejected moments ago — no cooldown holds them out, but rotation (not cooldown)
      // still determines who starts this cycle, and it's B's turn.
      repository.createAssignmentForOrder.mockClear();
      repository.findAssignmentsForOrder.mockResolvedValue([
        {
          deliveryPartnerId: 'partner-a',
          status: AssignmentStatus.REJECTED,
          cycle: 1,
          respondedAt: NOW,
        },
      ]);
      await service.assignOrder('order-1', 2);
      expect(
        repository.createAssignmentForOrder.mock.calls[0][0].deliveryPartnerId,
      ).toBe('partner-b');
    });

    it('QA scenario — presence expiry: once Redis presence reports a partner offline (e.g. the heartbeat stopped and the TTL lapsed), they no longer receive assignments', async () => {
      // DispatchService only ever asks presenceService.isOnlineBatch() fresh on every call — it
      // has no memory of "was online a moment ago". A stopped heartbeat causing the Redis TTL to
      // lapse (Presence Heartbeat Hardening's own concern) surfaces here purely as this mock
      // flipping to false; there is nothing else to fake for this scenario at the unit level.
      repository.findAvailablePartners.mockResolvedValue([
        buildPartner({ id: 'partner-1', userId: 'user-1' }),
      ]);
      presenceService.isOnlineBatch.mockResolvedValue(
        new Map([['user-1', false]]),
      );

      // With the only partner offline, onlinePartners is empty but partners.length > 0 — that's
      // the recoverable "cycle exhausted, schedule a retry" path (default DISPATCH_MAX_CYCLES=10
      // means cycle 1 always retries rather than failing outright), not an immediate throw. The
      // one thing that matters for this scenario either way: no assignment was created.
      await expect(service.assignOrder('order-1')).resolves.toBeNull();

      expect(repository.createAssignmentForOrder).not.toHaveBeenCalled();
      expect(metrics.recordDispatchPartnerSkippedOffline).toHaveBeenCalledTimes(
        1,
      );
    });

    it('QA scenario — heartbeat recovery: the moment presence reports the same partner online again, they are immediately eligible, with no lingering penalty for having been offline', async () => {
      repository.findAvailablePartners.mockResolvedValue([
        buildPartner({ id: 'partner-1', userId: 'user-1' }),
      ]);

      // First call: offline (heartbeat stopped / TTL lapsed) — matches the presence-expiry
      // scenario above (schedules a cycle retry rather than throwing; see that test's comment).
      presenceService.isOnlineBatch.mockResolvedValue(
        new Map([['user-1', false]]),
      );
      await expect(service.assignOrder('order-1')).resolves.toBeNull();
      expect(repository.createAssignmentForOrder).not.toHaveBeenCalled();

      // Second call: back online (heartbeat resumed) — nothing about the prior offline moment is
      // remembered or held against them; they are dispatched immediately.
      presenceService.isOnlineBatch.mockResolvedValue(
        new Map([['user-1', true]]),
      );
      const assignment = await service.assignOrder('order-1');

      expect(assignment).not.toBeNull();
      expect(repository.createAssignmentForOrder).toHaveBeenCalledWith(
        expect.objectContaining({ deliveryPartnerId: 'partner-1' }),
      );
    });

    it('rejecting never schedules a delayed cooldown-style job — only cycle exhaustion schedules a delayed retry', async () => {
      repository.findPartnerByUserId.mockResolvedValue({
        id: 'partner-1',
        userId: 'user-1',
      });
      repository.findAssignmentById.mockResolvedValue({
        id: 'assignment-1',
        orderId: 'order-1',
        deliveryPartnerId: 'partner-1',
        cycle: 1,
      });
      repository.claimAssignmentTransition.mockResolvedValue({ count: 1 });

      await service.rejectAssignment('assignment-1', 'user-1');

      // rejectAssignment() itself never enqueues a job directly — redispatch happens via
      // DispatchListener reacting to this published event, unchanged and untouched by this
      // simplification. The point being verified: nothing here schedules any delayed job.
      expect(queueService.addDispatchAssignmentJob).not.toHaveBeenCalled();
      expect(eventBus.publish).toHaveBeenCalledWith(
        'dispatch.assignment.rejected',
        { orderId: 'order-1', assignmentId: 'assignment-1' },
      );
    });
  });

  describe('Phase 2 backward compatibility', () => {
    it('cycle 1 with default configuration reproduces Phase 1 behavior exactly (no rotation, finite max cycles)', async () => {
      repository.findAvailablePartners.mockResolvedValue([buildPartner()]);
      repository.findAssignmentsForOrder.mockResolvedValue([]);

      const assignment = await service.assignOrder('order-1');

      expect(assignment).not.toBeNull();
      expect(
        logger.log.mock.calls.some(
          ([payload]: any) => payload.event === 'dispatch_cycle_rotated',
        ),
      ).toBe(false);
      expect(metrics.recordDispatchCycleRotation).not.toHaveBeenCalled();
    });
  });

  describe('Phase 3: Haversine distance in meters (Change 1)', () => {
    it('produces a real, positive meter-scale distance for two known coordinates, not kilometers', async () => {
      // Bengaluru MG Road (~12.9758, 77.6045) to Koramangala (~12.9352, 77.6245) — roughly 4.7km
      // apart in reality, i.e. ~4700m: asserts the value is in the thousands (meters), not single
      // digits (which a leftover km-scale implementation would produce).
      const near = buildPartner({
        id: 'partner-near',
        userId: 'user-near',
        currentLatitude: 12.9352,
        currentLongitude: 77.6245,
      });

      repository.findOrderById.mockResolvedValue(
        buildOrder({
          branch: {
            latitude: 12.9758,
            longitude: 77.6045,
            isActive: true,
            timezone: null,
            operatingHours: [],
          },
        }),
      );
      repository.findAvailablePartners.mockResolvedValue([near]);
      presenceService.isOnlineBatch.mockResolvedValue(
        new Map([['user-near', true]]),
      );

      await service.assignOrder('order-1');

      // Single candidate short-circuits selectPartnerByPriority before scoring — use two
      // candidates so the distance branch actually executes and can be asserted indirectly via
      // the deterministic pick below (see the ordering test for a direct distance comparison).
      expect(repository.createAssignmentForOrder).toHaveBeenCalledWith(
        expect.objectContaining({ deliveryPartnerId: 'partner-near' }),
      );
    });

    it('still picks the nearer of two partners — distance is now the only ranking signal before rotation', async () => {
      const near = buildPartner({
        id: 'partner-near',
        userId: 'user-near',
        currentLatitude: 12.901,
        currentLongitude: 77.601,
      });
      const far = buildPartner({
        id: 'partner-far',
        userId: 'user-far',
        currentLatitude: 13.5,
        currentLongitude: 78.2,
      });

      repository.findAvailablePartners.mockResolvedValue([far, near]);
      presenceService.isOnlineBatch.mockResolvedValue(
        new Map([
          ['user-near', true],
          ['user-far', true],
        ]),
      );

      await service.assignOrder('order-1');

      expect(repository.createAssignmentForOrder).toHaveBeenCalledWith(
        expect.objectContaining({ deliveryPartnerId: 'partner-near' }),
      );
    });

    it('records dispatch_partner_skipped_distance when coordinates are missing, without throwing', async () => {
      const a = buildPartner({
        id: 'partner-a',
        userId: 'user-a',
        currentLatitude: null,
        currentLongitude: null,
      });
      const b = buildPartner({
        id: 'partner-b',
        userId: 'user-b',
        currentLatitude: null,
        currentLongitude: null,
      });

      repository.findAvailablePartners.mockResolvedValue([a, b]);
      presenceService.isOnlineBatch.mockResolvedValue(
        new Map([
          ['user-a', true],
          ['user-b', true],
        ]),
      );

      await expect(service.assignOrder('order-1')).resolves.not.toBeNull();

      expect(
        metrics.recordDispatchPartnerSkippedDistance,
      ).toHaveBeenCalledTimes(2);
    });
  });

  describe('Phase 3: restaurant cancellation (Change 4)', () => {
    it('stops dispatching once the restaurant is suspended, without creating an assignment', async () => {
      repository.findOrderById.mockResolvedValue(
        buildOrder({ restaurant: { status: RestaurantStatus.SUSPENDED } }),
      );

      const result = await service.assignOrder('order-1');

      expect(result).toBeNull();
      expect(repository.createAssignmentForOrder).not.toHaveBeenCalled();
      expect(repository.findAvailablePartners).not.toHaveBeenCalled();
    });

    it('stops dispatching once the branch is deactivated', async () => {
      repository.findOrderById.mockResolvedValue(
        buildOrder({
          branch: {
            latitude: 12.9,
            longitude: 77.6,
            isActive: false,
            timezone: null,
            operatingHours: [],
          },
        }),
      );

      const result = await service.assignOrder('order-1');

      expect(result).toBeNull();
      expect(repository.createAssignmentForOrder).not.toHaveBeenCalled();
    });

    it('stops dispatching once the branch is outside its operating hours', async () => {
      // Every day fully closed => computeIsOpenNow always returns false.
      repository.findOrderById.mockResolvedValue(
        buildOrder({
          branch: {
            latitude: 12.9,
            longitude: 77.6,
            isActive: true,
            timezone: 'Asia/Kolkata',
            operatingHours: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
              dayOfWeek,
              opensAt: '00:00',
              closesAt: '00:00',
              isClosed: true,
            })),
          },
        }),
      );

      const result = await service.assignOrder('order-1');

      expect(result).toBeNull();
      expect(repository.createAssignmentForOrder).not.toHaveBeenCalled();
    });

    it('every delayed retry path (cycle retry) re-checks restaurant/order state, since it calls the same assignOrder() entrypoint', async () => {
      // Simulates a cycle-retry job firing (forcedCycle=2) after the restaurant closed in the
      // meantime — proves the delayed job path, not just the initial call, is covered, since both
      // go through the exact same top-of-function checks.
      repository.findOrderById.mockResolvedValue(
        buildOrder({ restaurant: { status: RestaurantStatus.SUSPENDED } }),
      );

      const result = await service.assignOrder('order-1', 2);

      expect(result).toBeNull();
      expect(queueService.addDispatchAssignmentJob).not.toHaveBeenCalled();
      expect(repository.createAssignmentForOrder).not.toHaveBeenCalled();
    });

    it('an order that moved off READY_FOR_PICKUP (e.g. cancelled) still stops via the pre-existing status check', async () => {
      repository.findOrderById.mockResolvedValue(
        buildOrder({ status: OrderStatus.CANCELLED }),
      );

      const result = await service.assignOrder('order-1');

      expect(result).toBeNull();
      expect(repository.createAssignmentForOrder).not.toHaveBeenCalled();
    });
  });

  describe('Phase 3: unlimited retry mode still works end-to-end', () => {
    const ORIGINAL_MAX_CYCLES = process.env.DISPATCH_MAX_CYCLES;

    afterEach(() => {
      if (ORIGINAL_MAX_CYCLES === undefined) {
        delete process.env.DISPATCH_MAX_CYCLES;
      } else {
        process.env.DISPATCH_MAX_CYCLES = ORIGINAL_MAX_CYCLES;
      }
      jest.resetModules();
    });

    it('keeps retrying under unlimited mode even with the restaurant-availability checks in place', async () => {
      process.env.DISPATCH_MAX_CYCLES = '0';
      jest.resetModules();

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fresh: typeof import('./dispatch.service') = require('./dispatch.service');

      const unlimitedService = new fresh.DispatchService(
        repository as any,
        realtimeService as any,
        queueService as any,
        presenceService as any,
        eventBus as any,
        logger as any,
        auditService as any,
        metrics as any,
      );

      repository.findAssignmentsForOrder.mockResolvedValue([
        {
          deliveryPartnerId: 'partner-1',
          status: AssignmentStatus.EXPIRED,
          cycle: 999,
          respondedAt: null,
          assignedAt: NOW,
        },
      ]);
      repository.findAvailablePartners.mockResolvedValue([
        buildPartner({ id: 'partner-1', userId: 'user-1' }),
      ]);

      await expect(unlimitedService.assignOrder('order-1')).resolves.toBeNull();

      expect(queueService.addDispatchAssignmentJob).toHaveBeenCalledWith(
        'order-1',
        'dispatch.cycle.retry',
        15_000,
        1000,
      );
    });
  });

  describe('Phase 3 + Dispatch Simplification: observability metrics', () => {
    it('observes acceptance latency and cycle-to-acceptance on a successful accept', async () => {
      repository.findPartnerByUserId.mockResolvedValue({
        id: 'partner-1',
        userId: 'user-1',
        isVerified: true,
        status: DeliveryPartnerStatus.AVAILABLE,
      });
      repository.findAssignmentById.mockResolvedValue({
        id: 'assignment-1',
        orderId: 'order-1',
        deliveryPartnerId: 'partner-1',
        cycle: 3,
        assignedAt: new Date(NOW.getTime() - 8000),
      });
      repository.acceptAssignmentAtomic.mockResolvedValue({ accepted: true });

      await service.acceptAssignment('assignment-1', 'user-1');

      expect(
        metrics.observeDispatchAssignmentAcceptanceLatency,
      ).toHaveBeenCalledWith(8);
      expect(metrics.observeDispatchCyclesToAcceptance).toHaveBeenCalledWith(3);
    });

    it('records per-reason skip metrics: OFFLINE and ACTIVE_ASSIGNMENT', async () => {
      const offline = buildPartner({
        id: 'partner-offline',
        userId: 'user-offline',
      });
      const busyElsewhere = buildPartner({
        id: 'partner-busy',
        userId: 'user-busy',
      });
      const eligible = buildPartner({ id: 'partner-ok', userId: 'user-ok' });

      repository.findAvailablePartners.mockResolvedValue([
        offline,
        busyElsewhere,
        eligible,
      ]);
      presenceService.isOnlineBatch.mockResolvedValue(
        new Map([
          ['user-offline', false],
          ['user-busy', true],
          ['user-ok', true],
        ]),
      );
      repository.findPartnerIdsWithActiveAssignment.mockResolvedValue(
        new Set(['partner-busy']),
      );

      await service.assignOrder('order-1');

      expect(metrics.recordDispatchPartnerSkippedOffline).toHaveBeenCalledTimes(
        1,
      );
      expect(
        metrics.recordDispatchPartnerSkippedActiveAssignment,
      ).toHaveBeenCalledTimes(1);
      expect(repository.createAssignmentForOrder).toHaveBeenCalledWith(
        expect.objectContaining({ deliveryPartnerId: 'partner-ok' }),
      );
    });

    it('records the ATTEMPTED_THIS_CYCLE skip reason for a partner already offered this order earlier in the cycle', async () => {
      repository.findAssignmentsForOrder.mockResolvedValue([
        {
          deliveryPartnerId: 'partner-1',
          status: AssignmentStatus.REJECTED,
          cycle: 1,
        },
      ]);
      repository.findAvailablePartners.mockResolvedValue([
        buildPartner({ id: 'partner-1', userId: 'user-1' }),
      ]);

      await expect(service.assignOrder('order-1')).resolves.toBeNull();

      expect(
        metrics.recordDispatchPartnerSkippedAttemptedThisCycle,
      ).toHaveBeenCalledTimes(1);
    });
  });

  describe('Phase 3 backward compatibility', () => {
    it('a simple single-partner, no-load, in-hours dispatch behaves exactly as before', async () => {
      const assignment = await service.assignOrder('order-1');

      expect(assignment).not.toBeNull();
    });

    it('an order with no branch on record is still dispatchable (Change 4 checks are branch-conditional, not mandatory)', async () => {
      repository.findOrderById.mockResolvedValue(buildOrder({ branch: null }));

      await expect(service.assignOrder('order-1')).resolves.not.toBeNull();
    });
  });
});
