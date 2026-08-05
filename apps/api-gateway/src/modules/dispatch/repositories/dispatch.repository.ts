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
      },
    });
  }
  async findOrderById(orderId: string) {
    return this.prisma.order.findUnique({
      where: {
        id: orderId,
      },
    });
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
