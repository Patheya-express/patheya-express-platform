import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import {
  AssignmentStatus,
  DeliveryPartnerStatus,
  OrderStatus,
  Prisma,
} from '@prisma/client';

type TransactionClient = Prisma.TransactionClient;

/** Discriminated result of createAssignmentForOrder — every "can't create" case is a normal,
 *  expected outcome (stale event redelivery, a redispatch racing an already-accepted order,
 *  order cancelled mid-dispatch), never an exception; callers log/no-op per reason. */
export type CreateAssignmentResult =
  | {
      created: true;
      assignment: { id: string; orderId: string; deliveryPartnerId: string };
    }
  | {
      created: false;
      reason:
        | 'order_not_found'
        | 'not_dispatchable'
        | 'already_has_partner'
        | 'active_assignment_exists';
    };

/** Reason codes for a failed acceptAssignmentAtomic claim — 'assignment_not_pending' preserves
 *  the pre-existing BadRequestException contract; 'partner_not_available'/'order_already_assigned'
 *  are the two new race outcomes this sprint closes (partner accepted a different offer first /
 *  order already claimed by a competing assignment). */
type AcceptFailureReason =
  | 'assignment_not_pending'
  | 'partner_not_available'
  | 'order_already_assigned';

export type AcceptAssignmentResult =
  | { accepted: true }
  | { accepted: false; reason: AcceptFailureReason };

/** Internal-only — thrown inside the interactive $transaction to force a rollback of every claim
 *  already applied in this call once a later claim in the same chain fails; caught immediately
 *  around the $transaction() call and converted back into an AcceptAssignmentResult. Never
 *  escapes this file. */
class AcceptClaimAborted extends Error {
  constructor(public readonly reason: AcceptFailureReason) {
    super(reason);
  }
}

@Injectable()
export class DispatchRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAssignmentById(assignmentId: string) {
    return this.prisma.deliveryAssignment.findUnique({
      where: {
        id: assignmentId,
      },
    });
  }

  /** Conditional claim, same philosophy as PaymentsRepository.claimStatusTransition — the row
   *  transitions only if it's still in one of `allowedFromStatuses` at the moment the UPDATE
   *  runs; `count` tells the caller whether THIS call was the one that won the transition (0 = a
   *  concurrent accept/reject/expiry already claimed the row first). Replaces the old
   *  find-then-update (updateAssignmentStatus), which had no such guarantee. */
  async claimAssignmentTransition(
    assignmentId: string,

    allowedFromStatuses: AssignmentStatus[],

    nextStatus: AssignmentStatus,
  ): Promise<{ count: number }> {
    return this.prisma.deliveryAssignment.updateMany({
      where: {
        id: assignmentId,

        status: { in: allowedFromStatuses },
      },

      data: {
        status: nextStatus,

        respondedAt: new Date(),
      },
    });
  }

  /**
   * Serializes "create a fresh PENDING assignment for this order" across every concurrent
   * caller (automatic dispatch, redispatch-on-reject/expiry, and manual admin assignment all
   * funnel through this one method) — closes the two-PENDING-assignments-for-one-order race that
   * a plain findActiveAssignmentForOrder()-then-create() can't, since under READ COMMITTED two
   * concurrent transactions can both see "no active assignment" before either has inserted one
   * (a phantom-read/insert race no amount of conditional UPDATE can catch, because there's no row
   * to condition on yet). Same pg_advisory_xact_lock philosophy as
   * CouponsRepository.reserveRedemption: a short, transaction-scoped lock keyed to this one
   * order, held only for the duration of the re-check + insert below — not a table lock, not
   * SERIALIZABLE, not a cross-service/Redis lock.
   */
  async createAssignmentForOrder(params: {
    orderId: string;
    deliveryPartnerId: string;
    expiresAt: Date;
    dispatchableStatuses: OrderStatus[];
    cycle: number;
  }): Promise<CreateAssignmentResult> {
    return this.prisma.$transaction(async (tx: TransactionClient) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${params.orderId}))`;

      const order = await tx.order.findUnique({
        where: { id: params.orderId },

        select: { id: true, status: true, deliveryPartnerId: true },
      });

      if (!order) {
        return { created: false, reason: 'order_not_found' } as const;
      }

      if (order.deliveryPartnerId) {
        return { created: false, reason: 'already_has_partner' } as const;
      }

      if (!params.dispatchableStatuses.includes(order.status)) {
        return { created: false, reason: 'not_dispatchable' } as const;
      }

      const activeAssignment = await tx.deliveryAssignment.findFirst({
        where: {
          orderId: params.orderId,

          status: { in: [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED] },
        },

        select: { id: true },
      });

      if (activeAssignment) {
        return { created: false, reason: 'active_assignment_exists' } as const;
      }

      const assignment = await tx.deliveryAssignment.create({
        data: {
          orderId: params.orderId,

          deliveryPartnerId: params.deliveryPartnerId,

          expiresAt: params.expiresAt,

          cycle: params.cycle,
        },
      });

      return { created: true, assignment } as const;
    });
  }

  /**
   * Bundles the three writes a successful accept must make — assignment PENDING→ACCEPTED,
   * partner AVAILABLE→ON_DELIVERY, order.deliveryPartnerId null→set — into one all-or-nothing
   * transaction, each write itself a conditional updateMany claim (same philosophy as
   * WalletRepository.applyToOrderAtomic's paired claim-then-verify). Whichever concurrent accept
   * (or the expiry processor) reaches the assignment row first wins; every loser gets a clean,
   * typed rejection reason instead of a corrupted partial state. The partner-status claim is
   * what makes a partner's second, concurrent accept of a *different* offer fail even though that
   * second assignment row itself is still independently PENDING — the partner, not the
   * assignment row, is the true single-winner resource once two live offers exist.
   */
  async acceptAssignmentAtomic(params: {
    assignmentId: string;
    deliveryPartnerId: string;
    deliveryPartnerUserId: string;
    orderId: string;
  }): Promise<AcceptAssignmentResult> {
    try {
      return await this.prisma.$transaction(async (tx: TransactionClient) => {
        const assignmentClaim = await tx.deliveryAssignment.updateMany({
          where: {
            id: params.assignmentId,

            status: AssignmentStatus.PENDING,
          },

          data: {
            status: AssignmentStatus.ACCEPTED,

            respondedAt: new Date(),
          },
        });

        if (assignmentClaim.count === 0) {
          throw new AcceptClaimAborted('assignment_not_pending');
        }

        const partnerClaim = await tx.deliveryPartner.updateMany({
          where: {
            id: params.deliveryPartnerId,

            status: DeliveryPartnerStatus.AVAILABLE,
          },

          data: {
            status: DeliveryPartnerStatus.ON_DELIVERY,
          },
        });

        if (partnerClaim.count === 0) {
          throw new AcceptClaimAborted('partner_not_available');
        }

        const orderClaim = await tx.order.updateMany({
          where: {
            id: params.orderId,

            deliveryPartnerId: null,
          },

          data: {
            deliveryPartnerId: params.deliveryPartnerUserId,
          },
        });

        if (orderClaim.count === 0) {
          throw new AcceptClaimAborted('order_already_assigned');
        }

        return { accepted: true } as const;
      });
    } catch (error) {
      if (error instanceof AcceptClaimAborted) {
        return { accepted: false, reason: error.reason };
      }

      throw error;
    }
  }

  // Production Readiness Stage C: dropped `include: { user: true }` — DispatchService.assignOrder
  // (the only caller) never reads `partner.user`, only `partner.id`/`partner.userId`; the join
  // was pure overhead on every automatic-dispatch attempt.
  async findAvailablePartners() {
    return this.prisma.deliveryPartner.findMany({
      where: {
        status: DeliveryPartnerStatus.AVAILABLE,

        isVerified: true,
      },
    });
  }

  /** Batched exclusion check for automatic dispatch — a partner with an outstanding PENDING
   *  offer (or, once accepted, no longer AVAILABLE anyway) elsewhere shouldn't also receive a
   *  fresh offer for a different order. Best-effort/UX filtering only: the real correctness
   *  guarantee against a partner winning two concurrent accepts is acceptAssignmentAtomic's
   *  partner-status claim above, not this check. */
  async findPartnerIdsWithActiveAssignment(
    partnerIds: string[],
  ): Promise<Set<string>> {
    if (partnerIds.length === 0) {
      return new Set();
    }

    const rows = await this.prisma.deliveryAssignment.findMany({
      where: {
        deliveryPartnerId: { in: partnerIds },

        status: { in: [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED] },
      },

      select: { deliveryPartnerId: true },
    });

    return new Set(rows.map((row) => row.deliveryPartnerId));
  }

  /** `status` is optional — omitted, returns every assignment for the partner (unchanged,
   *  pre-existing behavior); passed, narrows to that one AssignmentStatus (additive). */
  async findPartnerAssignments(partnerId: string, status?: AssignmentStatus) {
    return this.prisma.deliveryAssignment.findMany({
      where: {
        deliveryPartnerId: partnerId,

        ...(status ? { status } : {}),
      },

      include: {
        order: {
          include: {
            customer: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                phone: true,
              },
            },

            restaurant: {
              select: {
                id: true,
                name: true,
                phone: true,
              },
            },

            branch: {
              select: {
                addressLine1: true,
                addressLine2: true,
                city: true,
                state: true,
                postalCode: true,
                latitude: true,
                longitude: true,
              },
            },

            items: {
              include: {
                menuItem: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
        },
      },

      orderBy: {
        createdAt: 'desc',
      },
    });
  }
  async findPartnerByUserId(userId: string) {
    return this.prisma.deliveryPartner.findUnique({
      where: {
        userId,
      },
    });
  }

  /** By the DeliveryPartner's own primary key (as stored on DeliveryAssignment.deliveryPartnerId)
   *  — distinct from findPartnerByUserId, which looks up by the associated User's id instead. */
  async findPartnerById(id: string) {
    return this.prisma.deliveryPartner.findUnique({
      where: {
        id,
      },
    });
  }
  async findActiveAssignmentForOrder(orderId: string) {
    return this.prisma.deliveryAssignment.findFirst({
      where: {
        orderId,

        status: {
          in: [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED],
        },
      },
    });
  }

  /** Any PENDING/ACCEPTED assignment for this partner, regardless of which order — used by
   *  manual admin assignment to reject "already assigned partners" (a partner mid-assignment
   *  elsewhere shouldn't be double-booked by an admin override). */
  async findActiveAssignmentForPartner(deliveryPartnerId: string) {
    return this.prisma.deliveryAssignment.findFirst({
      where: {
        deliveryPartnerId,

        status: {
          in: [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED],
        },
      },
    });
  }

  async findAssignmentsForOrder(orderId: string) {
    return this.prisma.deliveryAssignment.findMany({
      where: {
        orderId,
      },

      select: {
        deliveryPartnerId: true,
        status: true,
        cycle: true,
        // Enterprise Dispatch Engine Enhancement — Phase 2 (rejection cooldown). Reuses the
        // pre-existing respondedAt column (already set by claimAssignmentTransition on every
        // reject/expiry) rather than adding a new timestamp — DispatchService.assignOrder()
        // compares this against DISPATCH_REJECTION_COOLDOWN_SECONDS to keep a partner who just
        // rejected out of the pool across a cycle boundary, without a new column or a timer.
        respondedAt: true,
        // Phase 3 (Change 6 — admin visibility). AdminDispatchService.getDispatchDebugInfo()'s
        // lastAttemptAt reuses this same query rather than adding a new one.
        assignedAt: true,
      },
    });
  }

  /**
   * Enterprise Dispatch Engine Enhancement — adds the pickup branch's coordinates (needed for the
   * "nearest to restaurant" priority tiebreak) on top of the pre-existing return shape. Purely
   * additive: every field `assignOrder()` already read off this result (`status`,
   * `deliveryPartnerId`, `customerId`, etc.) is untouched, this only adds a populated `branch`
   * relation that was previously left unfetched (Order.branchId is optional, so `branch` can
   * legitimately be null for an order with no branch on record — callers must treat missing
   * coordinates as "skip distance ranking for this order", not an error).
   *
   * Phase 3 (Change 4 — restaurant cancellation): also adds `branch.isActive`/`timezone`/
   * `operatingHours` and `restaurant.status`, needed for DispatchService.assignOrder() to detect
   * "the restaurant closed/became unavailable since this order was queued" on every call —
   * including every delayed BullMQ retry, since every one of them re-enters through this same
   * method. `operatingHours` reuses the exact shape `computeIsOpenNow` (restaurants module)
   * already expects — no new open-hours logic, the existing one is called as-is.
   */
  async findOrderById(orderId: string) {
    return this.prisma.order.findUnique({
      where: {
        id: orderId,
      },

      include: {
        branch: {
          select: {
            latitude: true,
            longitude: true,
            isActive: true,
            timezone: true,
            operatingHours: {
              select: {
                dayOfWeek: true,
                opensAt: true,
                closesAt: true,
                isClosed: true,
              },
            },
          },
        },

        restaurant: {
          select: { status: true },
        },
      },
    });
  }

  /**
   * Enterprise Dispatch Engine Enhancement — priority tiebreak #7 ("oldest previous assignment
   * timestamp"): the most recent `assignedAt` this partner has ever received, across every order,
   * any status. A partner absent from the returned map has never been assigned anything — callers
   * should treat that as more preferred than any real timestamp (they've been waiting longest).
   * `groupBy`'s `_max` keeps this to one aggregate query for the whole candidate list rather than
   * one query per partner.
   */
  async findLastAssignmentTimestamps(
    partnerIds: string[],
  ): Promise<Map<string, Date>> {
    if (partnerIds.length === 0) {
      return new Map();
    }

    const rows = await this.prisma.deliveryAssignment.groupBy({
      by: ['deliveryPartnerId'],

      where: { deliveryPartnerId: { in: partnerIds } },

      _max: { assignedAt: true },
    });

    return new Map(
      rows
        .filter((row) => row._max.assignedAt !== null)
        .map((row) => [row.deliveryPartnerId, row._max.assignedAt as Date]),
    );
  }

  /**
   * Phase 3 (Change 2 — partner load balancing), priority criterion #1 ("lowest active
   * workload"). Replaces the Phase 1 lifetime-assignment count, which eventually favored
   * whichever partner joined earliest forever (a partner's lifetime total only ever grows).
   * Counts current PENDING/ACCEPTED assignments per partner, same statuses
   * `findPartnerIdsWithActiveAssignment` already excludes on — by construction every candidate
   * reaching this ranking has 0 here (anyone non-zero was already filtered out upstream), so this
   * criterion is a guaranteed tie among `onlinePartners` under the current one-order-at-a-time
   * partner model. Kept anyway (not skipped) because it's the literal, explicitly requested first
   * criterion, gracefully falls through to #2 below (which does differentiate), and would start
   * differentiating on its own the moment multi-order carrying is ever introduced — without this
   * method needing to change at all.
   */
  async countActiveAssignmentsForPartners(
    partnerIds: string[],
  ): Promise<Map<string, number>> {
    if (partnerIds.length === 0) {
      return new Map();
    }

    const rows = await this.prisma.deliveryAssignment.groupBy({
      by: ['deliveryPartnerId'],

      where: {
        deliveryPartnerId: { in: partnerIds },
        status: { in: [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED] },
      },

      _count: { _all: true },
    });

    return new Map(rows.map((row) => [row.deliveryPartnerId, row._count._all]));
  }

  /**
   * Phase 3 (Change 2 — partner load balancing), priority criterion #2 ("fewest completed
   * deliveries in the last DISPATCH_LOAD_WINDOW_MINUTES"). There is no "completed" AssignmentStatus
   * (PENDING/ASSIGNED/ACCEPTED/REJECTED/EXPIRED only — `ASSIGNED` is unused dead enum, confirmed
   * nowhere referenced in application code) — a completed delivery is recorded on `Order`
   * (`status: DELIVERED`, `deliveredAt` set), keyed by `Order.deliveryPartnerId`, which — unlike
   * `DeliveryAssignment.deliveryPartnerId` — stores the delivery partner's *User* id
   * (`acceptAssignmentAtomic` sets it to `deliveryPartnerUserId`), so this is intentionally keyed
   * by `userId`, not `DeliveryPartner.id`, and callers must look it up accordingly. A partner
   * absent from the returned map completed 0 deliveries in the window.
   */
  async countRecentCompletedDeliveriesForPartners(
    partnerUserIds: string[],
    windowMs: number,
  ): Promise<Map<string, number>> {
    if (partnerUserIds.length === 0) {
      return new Map();
    }

    const rows = await this.prisma.order.groupBy({
      by: ['deliveryPartnerId'],

      where: {
        deliveryPartnerId: { in: partnerUserIds },
        status: OrderStatus.DELIVERED,
        deliveredAt: { gte: new Date(Date.now() - windowMs) },
      },

      _count: { _all: true },
    });

    return new Map(
      rows
        .filter((row) => row.deliveryPartnerId !== null)
        .map((row) => [row.deliveryPartnerId as string, row._count._all]),
    );
  }

  /**
   * Phase 3 (Change 3 — assignment notification rate limit). Reuses the pre-existing `assignedAt`
   * timestamp (set on every `createAssignmentForOrder` call, i.e. every time a partner is actually
   * notified) — no new column, no timer, no poll, same "compare a timestamp live during filtering"
   * shape as the Phase 2 rejection cooldown. Deliberately global (every order, every status), not
   * scoped to one order — this caps how many *notifications* a partner receives per minute overall,
   * not how many times they can be offered one specific order.
   */
  async countRecentAssignmentsForPartners(
    partnerIds: string[],
    windowMs: number,
  ): Promise<Map<string, number>> {
    if (partnerIds.length === 0) {
      return new Map();
    }

    const rows = await this.prisma.deliveryAssignment.groupBy({
      by: ['deliveryPartnerId'],

      where: {
        deliveryPartnerId: { in: partnerIds },
        assignedAt: { gte: new Date(Date.now() - windowMs) },
      },

      _count: { _all: true },
    });

    return new Map(rows.map((row) => [row.deliveryPartnerId, row._count._all]));
  }

  /**
   * Production Readiness Stage A (Crash Recovery): finds orders that have sat in
   * `READY_FOR_PICKUP` with no delivery partner for longer than `olderThanMs` — the stranded-order
   * case `DispatchReconciliationService` periodically re-scans for, the same "PaymentReconciliation
   * philosophy" `PaymentReconciliationService.reconcilePendingPayments()` already established for
   * payments. `updatedAt` is a pragmatic proxy for "hasn't changed state since becoming
   * dispatchable" — nothing else in the order lifecycle writes to a `READY_FOR_PICKUP` order
   * without also moving it out of that status, so a stale `updatedAt` here reliably means
   * assignment never succeeded (every prior BullMQ attempt failed or no partner was ever online).
   * Capped at 50 per scan so one reconciliation cycle can't overwhelm the dispatch queue if a
   * large backlog builds up during an extended outage.
   */
  async findStrandedReadyForPickupOrders(olderThanMs: number) {
    return this.prisma.order.findMany({
      where: {
        status: OrderStatus.READY_FOR_PICKUP,
        deliveryPartnerId: null,
        updatedAt: { lt: new Date(Date.now() - olderThanMs) },
      },
      select: { id: true },
      take: 50,
    });
  }
}
