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

    // Dispatch Simplification — a partner is eligible once: DeliveryPartner.status==AVAILABLE and
    // isVerified==true (both already enforced by findAvailablePartners()'s own WHERE clause,
    // reflected here in eligible_partner_count above), Redis presence==online, no ACTIVE
    // assignment (PENDING/ACCEPTED), and not already offered this order in the current cycle.
    // Nothing else — no rejection cooldown, no per-minute notification cap, no recent-completion
    // penalty. A partner with zero active assignments is immediately eligible for the next order.
    const onlinePartners = partners.filter((partner) => {
      if (onlineMap.get(partner.userId) !== true) {
        this.metrics.recordDispatchPartnerSkippedOffline();
        return false;
      }

      if (attemptedPartnerIds.includes(partner.id)) {
        this.metrics.recordDispatchPartnerSkippedAttemptedThisCycle();
        return false;
      }

      if (activePartnerAssignments.has(partner.id)) {
        this.metrics.recordDispatchPartnerSkippedActiveAssignment();
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
    // doc comment for the exact criteria and tie-break order. Synchronous since Dispatch
    // Simplification removed the last of its async data lookups (active workload, recent
    // completions, idle time) — distance and rotation are both pure, in-memory computations.
    const partner = this.selectPartnerByPriority(
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
   * Dispatch Simplification — deterministic priority ordering, reduced to exactly what the
   * business rule calls for and nothing else. `onlinePartners` has already passed every filter
   * (online, verified, available, not attempted this cycle, no active assignment elsewhere) —
   * this only decides which ONE of the survivors goes first:
   *   1. Active assignment count — already guaranteed zero for everyone here by the
   *      `findPartnerIdsWithActiveAssignment` filter above; there is nothing left to sort by for
   *      this criterion, so no additional query/field exists for it (it would be a no-op tie every
   *      time). Documented as satisfied by the filter, not as a redundant sort key.
   *   2. Nearest to the order's pickup branch, in meters (missing coordinates on either side sort
   *      last, never throw — an order with no branch on record, or a partner who's never reported
   *      a location, still gets dispatched, just without a distance advantage).
   *   3. Round-robin cycle rotation (unchanged from Phase 2 — see below).
   * No lifetime/recent assignment counts, no idle time, no last-assignment timestamp — a rider
   * with zero active assignments is immediately eligible for the next order, full stop.
   *
   * Pre-merge review finding: `findAvailablePartners()` has no `ORDER BY`, so Postgres gives no
   * ordering guarantee for its result — two partners genuinely tied on distance (the common case:
   * both missing coordinates, both scoring `Infinity`) would otherwise fall back to whatever row
   * order the query planner happened to produce, which can differ across deployments, replicas, or
   * even repeated runs against the same data. `Array.sort` is stable, so a tie preserves *input*
   * order — but that input order was never guaranteed in the first place. Partner `id` (a UUID,
   * unique, with no behavioral/historical meaning of its own) is added as the final tiebreaker
   * specifically to close that gap: it turns the sort into a true total order, independent of
   * whatever order the database returned partners in. This is deliberately NOT a reintroduction of
   * any removed business criterion — it carries no preference for any partner, only determinism.
   * Compared with plain `<`/`>` (safe but reads oddly for strings) rather than `localeCompare`
   * (ICU-dependent, and therefore not guaranteed identical across Node builds/environments) — the
   * one thing this must never do is vary by locale.
   *
   * Round-robin cycle start (Phase 2, unchanged): after the distance+id ranking above, the ranked
   * list is rotated by `(cycle - 1) % length` before picking index 0 — cycle 1 starts at the
   * nearest partner exactly as before, cycle 2 starts one position further round the same ranked
   * list, cycle 3 two positions further, and so on, wrapping around. Never randomized: the
   * rotation offset is a pure function of `cycle`, and `cycle` is itself already persisted on
   * `DeliveryAssignment` — so a worker restart mid-dispatch recomputes the exact same rotation
   * from the DB, no additional state needed. Rotation's own fairness guarantee ("cycle 2 starts
   * one position after cycle 1's start") only holds if the array being rotated is itself
   * deterministic — which is exactly what the id tiebreaker above now guarantees.
   */
  private selectPartnerByPriority(
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

      return { partner, distance };
    });

    scored.sort((a, b) => {
      if (a.distance !== b.distance) {
        return a.distance - b.distance;
      }

      // Deterministic tiebreaker — see this method's doc comment. Ordinal string comparison
      // only (never localeCompare), so this is identical on every machine/Node build.
      if (a.partner.id < b.partner.id) {
        return -1;
      }

      if (a.partner.id > b.partner.id) {
        return 1;
      }

      return 0;
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
