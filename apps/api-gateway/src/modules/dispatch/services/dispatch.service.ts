import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';

import {
  AssignmentStatus,
  AuditAction,
  DeliveryPartnerStatus,
  OrderStatus,
  RestaurantStatus,
} from '@prisma/client';

import { computeIsOpenNow } from '../../restaurants/utils/operating-hours.util';

import { DispatchRepository } from '../repositories/dispatch.repository';

import { RealtimeService } from '../../realtime/services/realtime.service';

import { QueueService } from 'src/infrastructure/queues/queue.service';

import { PresenceService } from '../../presence/services/presence.service';
import { EventBusService } from '../../../core/events/event-bus.service';
import { AppLoggerService } from '../../../infrastructure/logger/logger.service';
import { AuditService } from '../../audit/services/audit.service';
import { MetricsService } from '../../metrics/metrics.service';

import { DeliveryPartnerAssignedEvent } from '../events/delivery-partner-assigned.event';

/** Order statuses a fresh dispatch assignment may still be created for — anything else means
 *  the order moved on (or was cancelled) since `order.ready` fired, so assignment is a no-op,
 *  not an error (a stale/duplicate event re-trigger is expected, e.g. a delayed retry queued
 *  before a cancellation landed). */
const DISPATCHABLE_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.READY_FOR_PICKUP,
];

/**
 * Enterprise Dispatch Engine Enhancement — every dispatch timing knob is environment-configurable
 * with a documented default, never hardcoded inline inside assignOrder() itself (matches this
 * file's own pre-existing DISPATCHABLE_ORDER_STATUSES constant-at-module-top convention, and the
 * direct `process.env` read style already used elsewhere in this codebase, e.g.
 * redis-connection.config.ts). Read once at module load.
 */
const DISPATCH_ASSIGNMENT_TIMEOUT_SECONDS = Number(
  process.env.DISPATCH_ASSIGNMENT_TIMEOUT_SECONDS ?? 15,
);
const DISPATCH_CYCLE_RETRY_SECONDS = Number(
  process.env.DISPATCH_CYCLE_RETRY_SECONDS ?? 15,
);

/**
 * Enterprise Dispatch Engine Enhancement — Phase 2 (unlimited dispatch mode). `0` means "never
 * stop redispatching" — modeled as `Infinity` so the pre-existing `currentCycle < DISPATCH_MAX_CYCLES`
 * comparison below is simply always true, rather than adding a second branch/flag that has to be
 * kept in sync with it. Any positive integer keeps its literal, finite meaning exactly as before
 * (e.g. `5` still means "at most 5 cycles").
 */
const DISPATCH_MAX_CYCLES_CONFIGURED = Number(
  process.env.DISPATCH_MAX_CYCLES ?? 10,
);
const DISPATCH_MAX_CYCLES =
  DISPATCH_MAX_CYCLES_CONFIGURED === 0
    ? Infinity
    : DISPATCH_MAX_CYCLES_CONFIGURED;
const DISPATCH_UNLIMITED_MODE = DISPATCH_MAX_CYCLES_CONFIGURED === 0;

/**
 * Enterprise Dispatch Engine Enhancement — Phase 2 (rejection cooldown). How long a partner who
 * explicitly rejected an order stays excluded from it, even across a cycle boundary where the
 * cycle-scoped `attemptedPartnerIds` exclusion would otherwise have reset for them. Deliberately
 * scoped to REJECTED only, not EXPIRED — the problem this solves ("every partner rejects, then
 * immediately gets the same order again") is specific to an explicit decline, not a timeout.
 */
// Exported (not just module-private) so AdminDispatchService's debug endpoint (Phase 3, Change 6)
// reads the exact same configured value rather than duplicating the env-var-plus-default pattern.
export const DISPATCH_REJECTION_COOLDOWN_SECONDS = Number(
  process.env.DISPATCH_REJECTION_COOLDOWN_SECONDS ?? 60,
);

/**
 * Phase 3 (Change 2 — partner load balancing). Window for "fewest completed deliveries" —
 * replaces the Phase 1 lifetime-assignment-count tiebreak, which only ever grew for a given
 * partner and so eventually favored whoever joined earliest, permanently.
 */
const DISPATCH_LOAD_WINDOW_MINUTES = Number(
  process.env.DISPATCH_LOAD_WINDOW_MINUTES ?? 30,
);

/**
 * Phase 3 (Change 3 — assignment notification rate limit). A hard cap on how many assignment
 * *notifications* (i.e. `createAssignmentForOrder` calls — regardless of which order, regardless
 * of outcome) a single partner may receive within a rolling one-minute window, to stop
 * notification spam during a busy dispatch period. Deliberately distinct from
 * DISPATCH_REJECTION_COOLDOWN_SECONDS, which is scoped to one order.
 */
const DISPATCH_MAX_ASSIGNMENTS_PER_MINUTE = Number(
  process.env.DISPATCH_MAX_ASSIGNMENTS_PER_MINUTE ?? 4,
);
const DISPATCH_RATE_LIMIT_WINDOW_MS = 60 * 1000;

/**
 * Enterprise Dispatch Engine Enhancement — priority criterion "nearest to restaurant".
 * Haversine great-circle distance (already the formula used here since Phase 1 — Phase 3's audit
 * confirmed this was never a naive Euclidean lat/lng subtraction) — deterministic, no external
 * API/Maps SDK/network call. Phase 3 changed the unit from kilometers to meters (the literal
 * requirement) by switching the earth-radius constant; the algorithm itself is unchanged.
 */
function distanceMeters(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): number {
  const EARTH_RADIUS_METERS = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(to.latitude - from.latitude);
  const dLon = toRad(to.longitude - from.longitude);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(from.latitude)) *
      Math.cos(toRad(to.latitude)) *
      Math.sin(dLon / 2) ** 2;

  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Enterprise Dispatch Engine Enhancement — Phase 2's rejection-cooldown computation, extracted
 * into its own exported function in Phase 3 so AdminDispatchService's new debug endpoint (Change
 * 6) can report `cooldownPartners` without reimplementing this logic — the "no duplicated code"
 * non-functional requirement for this phase. Behavior is byte-for-byte identical to Phase 2's
 * original inline version; this is purely a location/reuse change, not a logic change.
 */
export function computeCooldownStatus(
  assignments: Array<{
    deliveryPartnerId: string;
    status: AssignmentStatus;
    respondedAt: Date | null;
  }>,
  cooldownSeconds: number,
  now: Date = new Date(),
): { onCooldown: Set<string>; lastRejectionByPartnerId: Map<string, Date> } {
  const lastRejectionByPartnerId = new Map<string, Date>();

  for (const assignment of assignments) {
    if (
      assignment.status === AssignmentStatus.REJECTED &&
      assignment.respondedAt
    ) {
      const existing = lastRejectionByPartnerId.get(
        assignment.deliveryPartnerId,
      );

      if (!existing || assignment.respondedAt > existing) {
        lastRejectionByPartnerId.set(
          assignment.deliveryPartnerId,
          assignment.respondedAt,
        );
      }
    }
  }

  const cooldownMs = cooldownSeconds * 1000;
  const nowMs = now.getTime();

  const onCooldown = new Set(
    [...lastRejectionByPartnerId.entries()]
      .filter(([, respondedAt]) => nowMs - respondedAt.getTime() < cooldownMs)
      .map(([partnerId]) => partnerId),
  );

  return { onCooldown, lastRejectionByPartnerId };
}

@Injectable()
export class DispatchService {
  constructor(
    private readonly dispatchRepository: DispatchRepository,

    private readonly realtimeService: RealtimeService,
    private readonly queueService: QueueService,
    private readonly presenceService: PresenceService,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
    private readonly auditService: AuditService,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Automatic assignment — invoked by DispatchListener on `order.ready`,
   * `dispatch.assignment.rejected`, and `dispatch.assignment.expired`. Idempotent and safe to
   * call repeatedly for the same order (Phase 4 validation below): an order that's already
   * actively assigned, already has a delivery partner, doesn't exist, or is no longer in a
   * dispatchable status is a logged no-op, never a duplicate assignment.
   */
  async assignOrder(orderId: string, forcedCycle?: number) {
    const order = await this.dispatchRepository.findOrderById(orderId);

    if (!order) {
      this.logger.error(
        {
          event: 'dispatch_assignment_failed',
          reason: 'order_not_found',
          orderId,
        },
        undefined,
        'DispatchService',
      );

      return null;
    }

    if (order.deliveryPartnerId) {
      this.logger.log(
        {
          event: 'dispatch_assignment_skipped',
          reason: 'order_already_has_delivery_partner',
          orderId,
          deliveryPartnerId: order.deliveryPartnerId,
        },
        'DispatchService',
      );

      return null;
    }

    if (!DISPATCHABLE_ORDER_STATUSES.includes(order.status)) {
      this.logger.log(
        {
          event: 'dispatch_assignment_skipped',
          reason: 'order_not_in_dispatchable_status',
          orderId,
          status: order.status,
        },
        'DispatchService',
      );

      return null;
    }

    // Phase 3 (Change 4 — restaurant cancellation). Every delayed BullMQ retry (cycle retry,
    // reconciliation, whatever triggered this call) re-enters assignOrder() from scratch and
    // re-fetches `order` fresh above — the dispatchable-status check right above this already
    // stops dispatching the moment the order itself moves on. This closes the two gaps that check
    // alone didn't cover: the restaurant's branch being deactivated, or the branch being outside
    // its own operating hours, while the order itself is technically still READY_FOR_PICKUP.
    // Reuses computeIsOpenNow (restaurants module) as-is — no new open-hours logic.
    if (order.restaurant?.status === RestaurantStatus.SUSPENDED) {
      this.logger.log(
        {
          event: 'dispatch_assignment_skipped',
          reason: 'restaurant_unavailable',
          orderId,
        },
        'DispatchService',
      );

      return null;
    }

    if (order.branch && !order.branch.isActive) {
      this.logger.log(
        {
          event: 'dispatch_assignment_skipped',
          reason: 'restaurant_branch_inactive',
          orderId,
        },
        'DispatchService',
      );

      return null;
    }

    if (
      order.branch &&
      !computeIsOpenNow(order.branch.operatingHours, order.branch.timezone)
    ) {
      this.logger.log(
        {
          event: 'dispatch_assignment_skipped',
          reason: 'restaurant_closed',
          orderId,
        },
        'DispatchService',
      );

      return null;
    }

    const activeAssignment =
      await this.dispatchRepository.findActiveAssignmentForOrder(orderId);

    if (activeAssignment) {
      this.logger.log(
        {
          event: 'dispatch_assignment_skipped',
          reason: 'active_assignment_already_exists',
          orderId,
          assignmentId: activeAssignment.id,
        },
        'DispatchService',
      );

      return activeAssignment;
    }

    const previousAssignments =
      await this.dispatchRepository.findAssignmentsForOrder(orderId);

    // Enterprise Dispatch Engine Enhancement — Change 2 (dispatch cycles). Cycle is normally
    // re-derived purely from the DB (idempotent, safe across worker restarts/horizontal scaling —
    // same design attemptedPartnerIds/activePartnerAssignments already relied on). The one
    // exception: when a cycle exhausts with zero eligible partners, no new DeliveryAssignment row
    // is ever written, so there is nothing in the DB to derive "we're on cycle N+1" from — that
    // fact only survives in the delayed retry job's own payload (forcedCycle, threaded through by
    // AssignmentExpiryProcessor from QueueService.addDispatchAssignmentJob's job data). Taking the
    // max of the two (never just trusting forcedCycle outright) keeps this safe against a stale or
    // duplicate retry job firing after the order has already legitimately moved further via a
    // different trigger in the meantime.
    const derivedCycle = previousAssignments.length
      ? Math.max(...previousAssignments.map((assignment) => assignment.cycle))
      : 1;

    const currentCycle =
      forcedCycle !== undefined
        ? Math.max(forcedCycle, derivedCycle)
        : derivedCycle;

    // "Attempted" is now scoped to the current cycle only — a partner offered and declined in a
    // previous cycle is eligible again once a new cycle starts. This is the actual fix for the
    // permanent-stuck-order bug: previously this was previousAssignments.map(...) unfiltered,
    // which never reset for the lifetime of the order.
    const attemptedPartnerIds = previousAssignments
      .filter((assignment) => assignment.cycle === currentCycle)
      .map((assignment) => assignment.deliveryPartnerId);

    const isFirstOfferInCycle = attemptedPartnerIds.length === 0;

    // Enterprise Dispatch Engine Enhancement — Phase 2 (rejection cooldown), extracted in Phase 3
    // into computeCooldownStatus() so AdminDispatchService's debug endpoint can reuse it verbatim
    // instead of reimplementing it. Behavior unchanged from Phase 2: reuses the pre-existing
    // respondedAt column, no new timestamp, no timer, no poll. Deliberately independent of
    // attemptedPartnerIds' cycle scoping — a recent reject still holds even across a new cycle.
    const { onCooldown: partnersOnCooldown, lastRejectionByPartnerId } =
      computeCooldownStatus(
        previousAssignments,
        DISPATCH_REJECTION_COOLDOWN_SECONDS,
      );

    const cooldownMs = DISPATCH_REJECTION_COOLDOWN_SECONDS * 1000;
    const nowMs = Date.now();

    const partners = await this.dispatchRepository.findAvailablePartners();

    this.logger.log(
      {
        event: 'eligible_delivery_partners_found',
        orderId,
        eligible_partner_count: partners.length,
      },
      'DispatchService',
    );

    // Batched via MGET (production-validation performance finding) — one Redis round trip for
    // every candidate partner instead of one sequential round trip per partner.
    const onlineMap = await this.presenceService.isOnlineBatch(
      partners.map((partner) => partner.userId),
    );

    const activePartnerAssignments =
      await this.dispatchRepository.findPartnerIdsWithActiveAssignment(
        partners.map((partner) => partner.id),
      );

    // Phase 3 (Change 3 — assignment notification rate limit). Global (every order, every
    // status) — reuses the pre-existing assignedAt timestamp, no new column/timer/poll, same
    // "compare live during filtering" shape as the Phase 2 cooldown.
    const recentAssignmentCounts =
      await this.dispatchRepository.countRecentAssignmentsForPartners(
        partners.map((partner) => partner.id),
        DISPATCH_RATE_LIMIT_WINDOW_MS,
      );

    // Phase 3 (Change 5 — observability). A plain filter() can't attribute *why* a given partner
    // didn't make it without running the same conditions twice — this loop computes each
    // exclusion reason once and increments its metric inline, then builds the same onlinePartners
    // result the pre-existing filter() produced.
    const onlinePartners = partners.filter((partner) => {
      if (onlineMap.get(partner.userId) !== true) {
        this.metrics.recordDispatchPartnerSkippedOffline();
        return false;
      }

      if (attemptedPartnerIds.includes(partner.id)) {
        return false;
      }

      if (activePartnerAssignments.has(partner.id)) {
        this.metrics.recordDispatchPartnerSkippedActiveAssignment();
        return false;
      }

      if (partnersOnCooldown.has(partner.id)) {
        return false;
      }

      if (
        (recentAssignmentCounts.get(partner.id) ?? 0) >=
        DISPATCH_MAX_ASSIGNMENTS_PER_MINUTE
      ) {
        this.logger.log(
          {
            event: 'dispatch_partner_rate_limited',
            orderId,
            cycle: currentCycle,
            partnerId: partner.id,
          },
          'DispatchService',
        );

        this.metrics.recordDispatchPartnerSkippedRateLimit();
        return false;
      }

      return true;
    });

    this.logger.log(
      {
        event: 'eligible_delivery_partners_filtered',
        orderId,
        eligible_partner_count: partners.length,
        filtered_partner_count: onlinePartners.length,
        cycle: currentCycle,
      },
      'DispatchService',
    );

    // Enterprise Dispatch Engine Enhancement — Phase 2 (rejection cooldown logging). Both events
    // are derived purely from the timestamp comparison above, computed fresh on this call — no
    // separate "cooldown expired" detection/state, exactly as required ("naturally expire through
    // timestamps checked during partner filtering").
    for (const [partnerId, respondedAt] of lastRejectionByPartnerId) {
      const elapsedMs = nowMs - respondedAt.getTime();

      if (elapsedMs < cooldownMs) {
        this.logger.log(
          {
            event: 'dispatch_partner_cooldown',
            orderId,
            cycle: currentCycle,
            partnerId,
            cooldownSeconds: Math.ceil((cooldownMs - elapsedMs) / 1000),
          },
          'DispatchService',
        );

        this.metrics.recordDispatchPartnerCooldown();
      } else if (onlinePartners.some((partner) => partner.id === partnerId)) {
        this.logger.log(
          {
            event: 'dispatch_partner_cooldown_expired',
            orderId,
            cycle: currentCycle,
            partnerId,
            cooldownSeconds: DISPATCH_REJECTION_COOLDOWN_SECONDS,
          },
          'DispatchService',
        );
      }
    }

    if (isFirstOfferInCycle && onlinePartners.length > 0) {
      this.logger.log(
        {
          event: 'dispatch_cycle_started',
          orderId,
          cycle: currentCycle,
          remainingPartners: onlinePartners.length,
        },
        'DispatchService',
      );

      this.metrics.recordDispatchCycleStarted();
    }

    if (!onlinePartners.length) {
      // Enterprise Dispatch Engine Enhancement — Change 2/4. partners.length > 0 means eligible
      // partners exist but every one of them has already been offered this order in the current
      // cycle (or is online/available but currently tied up elsewhere) — this cycle is exhausted,
      // not "no delivery partners exist at all". Below DISPATCH_MAX_CYCLES, that's recoverable:
      // schedule a fresh cycle instead of failing the order.
      if (partners.length > 0 && currentCycle < DISPATCH_MAX_CYCLES) {
        this.logger.log(
          {
            event: 'dispatch_cycle_completed',
            orderId,
            cycle: currentCycle,
            remainingPartners: 0,
          },
          'DispatchService',
        );

        this.logger.log(
          {
            event: 'dispatch_cycle_retry',
            orderId,
            cycle: currentCycle,
            nextCycle: currentCycle + 1,
            retryInSeconds: DISPATCH_CYCLE_RETRY_SECONDS,
          },
          'DispatchService',
        );

        this.metrics.recordDispatchCycleRetry();

        // Enterprise Dispatch Engine Enhancement — Phase 2 (unlimited dispatch mode). Purely
        // observational — DISPATCH_UNLIMITED_MODE already made DISPATCH_MAX_CYCLES effectively
        // Infinity above, so no separate branch was needed to make retrying work; this only makes
        // "we're in unlimited mode" visible in logs/metrics rather than looking identical to a
        // very large finite DISPATCH_MAX_CYCLES.
        if (DISPATCH_UNLIMITED_MODE) {
          this.logger.log(
            {
              event: 'dispatch_unlimited_mode',
              orderId,
              cycle: currentCycle,
              nextCycle: currentCycle + 1,
            },
            'DispatchService',
          );

          this.metrics.recordDispatchUnlimitedCycle();
        }

        // Reuses the exact same 'dispatch' queue / 'dispatch-assignment' job / AssignmentExpiryProcessor
        // as every other dispatch trigger — only a delay and a new sourceEvent string, no new queue
        // or processor. Durable (survives worker restart) exactly like addAssignmentExpiryJob's
        // existing delayed jobs already are.
        await this.queueService.addDispatchAssignmentJob(
          orderId,
          'dispatch.cycle.retry',
          DISPATCH_CYCLE_RETRY_SECONDS * 1000,
          currentCycle + 1,
        );

        return null;
      }

      this.logger.error(
        {
          event: 'dispatch_assignment_failed',
          reason: 'no_delivery_partners_available',
          orderId,
          eligible_partner_count: partners.length,
          cycle: currentCycle,
        },
        undefined,
        'DispatchService',
      );

      // Only a genuine cycle exhaustion (there WERE eligible partners) counts as "max cycles
      // reached" — a partner pool that was empty from the start (partners.length === 0) is the
      // pre-existing, unrelated "nobody is verified/available at all" case, not a cycle failure.
      if (partners.length > 0) {
        this.logger.error(
          {
            event: 'dispatch_max_cycles_reached',
            orderId,
            cycle: currentCycle,
          },
          undefined,
          'DispatchService',
        );

        this.metrics.recordDispatchMaxCyclesReached();
      }

      throw new NotFoundException('No delivery partners available');
    }

    // Enterprise Dispatch Engine Enhancement — Change 3 (deterministic priority ordering).
    // Replaces the previous onlinePartners[0] (implicit Postgres row order — findAvailablePartners()
    // has no ORDER BY) with an explicit, reproducible ranking. See selectPartnerByPriority's own
    // doc comment for the exact criteria and tie-break order.
    const partner = await this.selectPartnerByPriority(
      order,
      onlinePartners,
      orderId,
      currentCycle,
    );

    const expiresAt = new Date(
      Date.now() + DISPATCH_ASSIGNMENT_TIMEOUT_SECONDS * 1000,
    );

    const result = await this.dispatchRepository.createAssignmentForOrder({
      orderId,

      deliveryPartnerId: partner.id,

      expiresAt,

      dispatchableStatuses: DISPATCHABLE_ORDER_STATUSES,

      cycle: currentCycle,
    });

    if (!result.created) {
      // Lost the race — another concurrent assignOrder() call (duplicate order.ready delivery,
      // a simultaneous redispatch trigger, or a manual admin assignment) already claimed this
      // order first. Same idempotent-no-op contract as the pre-existing early-exit checks above.
      this.logger.log(
        {
          event: 'dispatch_assignment_skipped',
          reason: result.reason,
          orderId,
        },
        'DispatchService',
      );

      return null;
    }

    const assignment = result.assignment;

    this.logger.log(
      {
        event: 'dispatch_assignment_created',
        orderId,
        assignmentId: assignment.id,
        deliveryPartnerId: partner.id,
        cycle: currentCycle,
      },
      'DispatchService',
    );

    this.logger.log(
      {
        event: 'dispatch_assignment_saved',
        orderId,
        assignmentId: assignment.id,
      },
      'DispatchService',
    );

    await this.auditService.log(
      null,
      'DeliveryAssignment',
      assignment.id,
      AuditAction.CREATE,
      null,
      {
        event: 'AUTO_ASSIGNMENT_CREATED',
        orderId,
        deliveryPartnerId: partner.id,
      },
    );

    this.realtimeService.emitToUser(
      partner.userId,

      'delivery.assignment',

      {
        assignmentId: assignment.id,

        orderId,
      },
    );

    this.logger.log(
      {
        event: 'dispatch_notification_sent',
        orderId,
        assignmentId: assignment.id,
        deliveryPartnerUserId: partner.userId,
      },
      'DispatchService',
    );

    await this.queueService.addAssignmentExpiryJob(
      assignment.id,
      DISPATCH_ASSIGNMENT_TIMEOUT_SECONDS * 1000,
    );

    if (order) {
      await this.eventBus.publish(
        'delivery.partner.assigned',

        new DeliveryPartnerAssignedEvent(
          order.id,

          order.customerId,

          partner.userId,
        ),
      );
    }

    return assignment;
  }

  /**
   * Enterprise Dispatch Engine Enhancement — deterministic priority ordering. `onlinePartners`
   * has already passed every existing filter (online, verified, available, not attempted this
   * cycle, no active assignment elsewhere, not on rejection cooldown, under the notification rate
   * limit) — this only decides which ONE of the survivors goes first. Priority, in order (never
   * randomized; a tie at every criterion falls through to the next, and a total tie preserves
   * `onlinePartners`' own incoming order, itself a stable, deterministic `Array.sort`):
   *   Phase 3 (Change 2 — partner load balancing), replacing Phase 1's distance-first ordering:
   *     1. Lowest active workload (current PENDING/ACCEPTED assignment count — see
   *        countActiveAssignmentsForPartners's own doc comment for why this is always 0 among
   *        candidates reaching here today, and why it's kept anyway).
   *     2. Fewest completed deliveries in the last DISPATCH_LOAD_WINDOW_MINUTES.
   *     3. Nearest to the order's pickup branch, in meters (missing coordinates on either side
   *        sort last, never throw).
   *     4. Longest idle (oldest Redis presence `lastSeen`; no presence timestamp on record sorts
   *        last, not first).
   *   Preserved from Phase 1 as one further, final tiebreak beyond the four explicitly specified
   *   above — not requested to be removed, and free since the query already existed:
   *     5. Oldest previous assignment timestamp (never assigned anything sorts first).
   * (Online, Verified, Available are the pre-existing filters that already ran, before this.)
   *
   * Enterprise Dispatch Engine Enhancement — Phase 2 (round-robin cycle start). After the above
   * produces its fully deterministic ranking, the ranked list is rotated by `(cycle - 1) % length`
   * before picking index 0 — cycle 1 starts at the top-ranked partner exactly as before, cycle 2
   * starts one position further round the same ranked list, cycle 3 two positions further, and so
   * on, wrapping around. Never randomized: the rotation offset is a pure function of `cycle`, and
   * `cycle` is itself already persisted on `DeliveryAssignment` — so a worker restart mid-dispatch
   * recomputes the exact same rotation from the DB, no additional state needed. Because
   * `onlinePartners` here has already excluded every partner attempted earlier in THIS cycle, the
   * same rotation offset applied to each successive (shrinking) candidate list within one cycle
   * naturally produces "start at B, then C, then A" rather than re-offering the same partner
   * rotation picked first — verified by dispatch.service.spec.ts's round-robin fairness tests.
   */
  private async selectPartnerByPriority(
    order: {
      branch: { latitude: number | null; longitude: number | null } | null;
    },
    onlinePartners: Array<{
      id: string;
      userId: string;
      currentLatitude: number | null;
      currentLongitude: number | null;
    }>,
    orderId: string,
    cycle: number,
  ) {
    if (onlinePartners.length === 1) {
      return onlinePartners[0];
    }

    const partnerIds = onlinePartners.map((partner) => partner.id);
    const partnerUserIds = onlinePartners.map((partner) => partner.userId);
    const loadWindowMs = DISPATCH_LOAD_WINDOW_MINUTES * 60 * 1000;

    const [
      lastSeenByUserId,
      activeWorkloadByPartnerId,
      recentCompletionsByUserId,
      lastAssignmentByPartnerId,
    ] = await Promise.all([
      this.presenceService.getLastSeenBatch(partnerUserIds),
      this.dispatchRepository.countActiveAssignmentsForPartners(partnerIds),
      this.dispatchRepository.countRecentCompletedDeliveriesForPartners(
        partnerUserIds,
        loadWindowMs,
      ),
      this.dispatchRepository.findLastAssignmentTimestamps(partnerIds),
    ]);

    const branchLat = order.branch?.latitude;
    const branchLon = order.branch?.longitude;
    const hasBranchLocation = branchLat != null && branchLon != null;

    const scored = onlinePartners.map((partner) => {
      const hasPartnerLocation =
        partner.currentLatitude != null && partner.currentLongitude != null;

      let distance: number;

      if (hasBranchLocation && hasPartnerLocation) {
        distance = distanceMeters(
          { latitude: branchLat, longitude: branchLon },
          {
            latitude: partner.currentLatitude as number,
            longitude: partner.currentLongitude as number,
          },
        );
      } else {
        distance = Number.POSITIVE_INFINITY;
        this.metrics.recordDispatchPartnerSkippedDistance();
      }

      const activeWorkload = activeWorkloadByPartnerId.get(partner.id) ?? 0;

      const recentCompletions =
        recentCompletionsByUserId.get(partner.userId) ?? 0;

      const lastSeen = lastSeenByUserId.get(partner.userId) ?? null;
      const idleSortKey = lastSeen
        ? lastSeen.getTime()
        : Number.POSITIVE_INFINITY;

      const lastAssignment = lastAssignmentByPartnerId.get(partner.id) ?? null;
      const lastAssignmentSortKey = lastAssignment
        ? lastAssignment.getTime()
        : Number.NEGATIVE_INFINITY;

      return {
        partner,
        activeWorkload,
        recentCompletions,
        distance,
        idleSortKey,
        lastAssignmentSortKey,
      };
    });

    scored.sort((a, b) => {
      if (a.activeWorkload !== b.activeWorkload) {
        return a.activeWorkload - b.activeWorkload;
      }

      if (a.recentCompletions !== b.recentCompletions) {
        return a.recentCompletions - b.recentCompletions;
      }

      if (a.distance !== b.distance) {
        return a.distance - b.distance;
      }

      if (a.idleSortKey !== b.idleSortKey) {
        return a.idleSortKey - b.idleSortKey;
      }

      return a.lastAssignmentSortKey - b.lastAssignmentSortKey;
    });

    const rotationOffset = (cycle - 1) % scored.length;

    if (rotationOffset > 0) {
      const rotated = [
        ...scored.slice(rotationOffset),
        ...scored.slice(0, rotationOffset),
      ];

      this.logger.log(
        {
          event: 'dispatch_cycle_rotated',
          orderId,
          cycle,
          partnerId: rotated[0].partner.id,
        },
        'DispatchService',
      );

      this.metrics.recordDispatchCycleRotation();

      return rotated[0].partner;
    }

    return scored[0].partner;
  }

  async acceptAssignment(
    assignmentId: string,

    userId: string,
  ) {
    const partner = await this.dispatchRepository.findPartnerByUserId(userId);

    if (!partner) {
      throw new NotFoundException('Delivery partner not found');
    }

    const assignment =
      await this.dispatchRepository.findAssignmentById(assignmentId);

    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }

    if (assignment.deliveryPartnerId !== partner.id) {
      throw new ForbiddenException('Assignment does not belong to you');
    }

    // EDPH-1 online-protection, defense-in-depth: assignments are only ever created for
    // partners findAvailablePartners() already filtered to isVerified+AVAILABLE, but re-check
    // here too so a partner who loses verification/gets suspended mid-assignment can't accept.
    if (
      !partner.isVerified ||
      partner.status === DeliveryPartnerStatus.SUSPENDED
    ) {
      throw new ForbiddenException(
        'Your account is not eligible to accept assignments',
      );
    }

    // The authoritative check: assignment.status above is a pre-fetched snapshot, not proof the
    // row is still PENDING right now — a concurrent accept, reject, or the expiry processor may
    // have already claimed it. acceptAssignmentAtomic re-verifies and claims the assignment,
    // the partner, and the order together, atomically; nothing about "am I allowed to accept"
    // is trusted from the read above.
    const result = await this.dispatchRepository.acceptAssignmentAtomic({
      assignmentId,

      deliveryPartnerId: partner.id,

      deliveryPartnerUserId: partner.userId,

      orderId: assignment.orderId,
    });

    if (!result.accepted) {
      if (result.reason === 'assignment_not_pending') {
        throw new BadRequestException(
          'Only pending assignments can be accepted',
        );
      }

      if (result.reason === 'partner_not_available') {
        throw new ConflictException(
          'You are no longer available to accept this assignment',
        );
      }

      throw new ConflictException(
        'This order already has a delivery partner assigned',
      );
    }

    this.logger.log(
      {
        event: 'dispatch_assignment_accepted',
        assignmentId,
        orderId: assignment.orderId,
        deliveryPartnerId: partner.id,
      },
      'DispatchService',
    );

    // Enterprise Dispatch Engine Enhancement — required structured logs/metrics for the
    // acceptance path. Additive alongside the pre-existing dispatch_assignment_accepted log
    // above, not a replacement — anything already keyed off that event name is unaffected.
    this.logger.log(
      {
        event: 'dispatch_partner_accepted',
        orderId: assignment.orderId,
        cycle: assignment.cycle,
        partnerId: partner.id,
      },
      'DispatchService',
    );

    this.logger.log(
      {
        event: 'dispatch_completed',
        orderId: assignment.orderId,
        assignmentId,
        cycle: assignment.cycle,
        partnerId: partner.id,
      },
      'DispatchService',
    );

    this.metrics.recordDispatchPartnerAccept();

    // Phase 3 (Change 5 — observability). assignment.assignedAt is this offer's own creation
    // timestamp (already fetched above via findAssignmentById, unrelated to the respondedAt
    // acceptAssignmentAtomic just wrote) — Date.now() here is this acceptance's own moment, more
    // accurate than re-reading the row back for its just-written respondedAt.
    this.metrics.observeDispatchAssignmentAcceptanceLatency(
      (Date.now() - assignment.assignedAt.getTime()) / 1000,
    );
    this.metrics.observeDispatchCyclesToAcceptance(assignment.cycle);

    await this.auditService.log(
      userId,
      'DeliveryAssignment',
      assignmentId,
      AuditAction.STATUS_CHANGE,
      { status: AssignmentStatus.PENDING },
      { event: 'ASSIGNMENT_ACCEPTED', status: AssignmentStatus.ACCEPTED },
    );

    this.realtimeService.emitToOrder(
      assignment.orderId,
      'dispatch.assignment.accepted',
      {
        assignmentId,
        orderId: assignment.orderId,
      },
    );

    return {
      success: true,
    };
  }

  async rejectAssignment(
    assignmentId: string,

    userId: string,
  ) {
    const partner = await this.dispatchRepository.findPartnerByUserId(userId);

    if (!partner) {
      throw new NotFoundException('Delivery partner not found');
    }

    const assignment =
      await this.dispatchRepository.findAssignmentById(assignmentId);

    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }

    if (assignment.deliveryPartnerId !== partner.id) {
      throw new ForbiddenException('Assignment does not belong to you');
    }

    // Same TOCTOU close as acceptAssignment: the row's real status is claimed atomically here,
    // not trusted from the read above (a concurrent accept or the expiry processor may have
    // already claimed it).
    const claim = await this.dispatchRepository.claimAssignmentTransition(
      assignmentId,

      [AssignmentStatus.PENDING],

      AssignmentStatus.REJECTED,
    );

    if (claim.count === 0) {
      throw new BadRequestException('Only pending assignments can be rejected');
    }

    this.logger.log(
      {
        event: 'dispatch_assignment_rejected',
        assignmentId,
        orderId: assignment.orderId,
        deliveryPartnerId: partner.id,
      },
      'DispatchService',
    );

    // Enterprise Dispatch Engine Enhancement — required structured log/metric for the rejection
    // path, additive alongside the pre-existing dispatch_assignment_rejected log above.
    this.logger.log(
      {
        event: 'dispatch_partner_rejected',
        orderId: assignment.orderId,
        cycle: assignment.cycle,
        partnerId: partner.id,
      },
      'DispatchService',
    );

    this.metrics.recordDispatchPartnerReject();

    await this.auditService.log(
      userId,
      'DeliveryAssignment',
      assignmentId,
      AuditAction.STATUS_CHANGE,
      { status: AssignmentStatus.PENDING },
      { event: 'ASSIGNMENT_REJECTED', status: AssignmentStatus.REJECTED },
    );

    await this.eventBus.publish(
      'dispatch.assignment.rejected',

      {
        orderId: assignment.orderId,

        assignmentId: assignment.id,
      },
    );

    return {
      success: true,
    };
  }

  /** `status` is additive/optional — omitted, this returns exactly what it always has (every
   *  assignment for the partner, newest first); passed, it narrows to that one AssignmentStatus.
   *  No existing caller (DispatchController's current route) passes it, so behavior for them is
   *  unchanged. */
  async getAssignments(userId: string, status?: AssignmentStatus) {
    const partner = await this.dispatchRepository.findPartnerByUserId(userId);

    if (!partner) {
      throw new NotFoundException('Delivery partner not found');
    }

    const assignments = await this.dispatchRepository.findPartnerAssignments(
      partner.id,

      status,
    );

    return assignments.map((assignment: any) => ({
      ...assignment,

      order: assignment.order && {
        ...assignment.order,

        items: assignment.order.items.map((item: any) => ({
          ...item,

          menuItemName: item.menuItem?.name,

          menuItem: undefined,
        })),
      },
    }));
  }
}
