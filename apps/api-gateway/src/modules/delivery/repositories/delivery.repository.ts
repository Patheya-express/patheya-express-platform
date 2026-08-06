import { Injectable } from '@nestjs/common';

import {
  AssignmentStatus,
  DeliveryPartnerStatus,
  OrderStatus,
} from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import { BaseRepository } from '../../../infrastructure/database/repositories/base.repository';

const ACTIVE_PARTNER_STATUSES: DeliveryPartnerStatus[] = [
  DeliveryPartnerStatus.AVAILABLE,
  DeliveryPartnerStatus.ON_DELIVERY,
];

const NON_TERMINAL_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.PENDING,
  OrderStatus.CONFIRMED,
  OrderStatus.PREPARING,
  OrderStatus.READY_FOR_PICKUP,
  OrderStatus.OUT_FOR_DELIVERY,
];

export interface AdminDeliveryFilterParams {
  search?: string;
  status?: DeliveryPartnerStatus;
  availability?: boolean;
  verified?: boolean;
  dateFrom?: string;
  dateTo?: string;
}

export interface DeliveryPartnerStats {
  completedDeliveries: Map<string, number>;
  todaysDeliveries: Map<string, number>;
  estimatedFeesToday: Map<string, number>;
  currentOrder: Map<
    string,
    {
      id: string;
      orderNumber: string;
      status: OrderStatus;
      restaurantName: string;
    }
  >;
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

@Injectable()
export class DeliveryRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async createDeliveryPartner(data: any) {
    return this.prisma.deliveryPartner.create({
      data,
    });
  }

  async findPartnerByUserId(userId: string) {
    return this.prisma.deliveryPartner.findUnique({
      where: {
        userId,
      },
    });
  }

  /** EDPH-1 — used by the online-protection eligibility check, which needs both the partner's
   *  isVerified/status and the underlying User.status (a partner can be individually SUSPENDED
   *  as a DeliveryPartner and/or have their User account SUSPENDED/BLOCKED independently). */
  async findPartnerWithUserByUserId(userId: string) {
    return this.prisma.deliveryPartner.findUnique({
      where: { userId },
      include: { user: { select: { status: true } } },
    });
  }

  async updatePartnerStatus(
    userId: string,

    status: any,
  ) {
    return this.prisma.deliveryPartner.update({
      where: {
        userId,
      },

      data: {
        status,
      },
    });
  }

  /** The ON_DELIVERY→AVAILABLE counterpart to acceptAssignmentAtomic's AVAILABLE→ON_DELIVERY
   *  claim — conditional, not a plain update: a partner who's OFFLINE/SUSPENDED (e.g. suspended
   *  mid-delivery, or who force-went-offline) must not be silently pulled back to AVAILABLE just
   *  because their order finally reached DELIVERED/CANCELLED. `count` tells the caller whether a
   *  release actually happened.
   *
   *  `orderId`, when passed, also closes out that order's PENDING/ACCEPTED DeliveryAssignment row
   *  to COMPLETED in the same transaction. Without this, the assignment stayed ACCEPTED forever —
   *  findPartnerIdsWithActiveAssignment() (dispatch.repository.ts) treats PENDING/ACCEPTED as
   *  "still busy" on ANY order, so a partner who had ever completed a single delivery became
   *  permanently excluded from all future automatic dispatch, regardless of presence/status.
   *  Optional (not required) so existing callers/tests that only care about the partner-status
   *  release, with no real order/assignment in play, are unaffected. */
  async releaseFromDelivery(
    userId: string,
    orderId?: string,
  ): Promise<{ count: number }> {
    return this.prisma.$transaction(async (tx) => {
      const partnerResult = await tx.deliveryPartner.updateMany({
        where: {
          userId,

          status: DeliveryPartnerStatus.ON_DELIVERY,
        },

        data: {
          status: DeliveryPartnerStatus.AVAILABLE,
        },
      });

      if (orderId) {
        await tx.deliveryAssignment.updateMany({
          where: {
            orderId,

            status: {
              in: [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED],
            },
          },

          data: {
            status: AssignmentStatus.COMPLETED,
          },
        });
      }

      return partnerResult;
    });
  }

  async getAssignedOrders(userId: string) {
    return this.prisma.order.findMany({
      where: {
        deliveryPartnerId: userId,
      },

      include: {
        restaurant: true,

        items: true,
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

  async countActivePartners(): Promise<number> {
    return this.prisma.deliveryPartner.count({
      where: {
        status: {
          in: ACTIVE_PARTNER_STATUSES,
        },
      },
    });
  }

  async findById(id: string) {
    return this.prisma.deliveryPartner.findUnique({
      where: {
        id,
      },
    });
  }

  /**
   * Sprint 1.9 — the exactly-once claim behind admin operational-status transitions
   * (suspendPartner/restorePartner/forceOffline), same conditional-updateMany philosophy as
   * RestaurantsRepository.claimStatusTransition. Replaces the old find-then-update
   * (updatePartnerStatusById), which let two concurrent admin actions on the same partner (e.g.
   * suspend racing restore) both pass their JS status check and both write.
   */
  async claimPartnerStatus(
    id: string,

    allowedFromStatuses: DeliveryPartnerStatus[],

    nextStatus: DeliveryPartnerStatus,
  ): Promise<{ count: number }> {
    return this.prisma.deliveryPartner.updateMany({
      where: {
        id,

        status: { in: allowedFromStatuses },
      },

      data: {
        status: nextStatus,
      },
    });
  }

  /**
   * The legacy-approve/reject counterpart of claimPartnerStatus, for the `isVerified` boolean
   * gate directly (DeliveryService.approvePartner/rejectPartner — "kept for backward
   * compatibility" per this field's own schema doc comment). Approve requires isVerified still
   * false (so a partner can't become APPROVED twice); reject requires isVerified still true
   * (revoking an approval that's actually in effect) — see DeliveryService for the full reasoning.
   */
  async claimVerification(
    id: string,

    requiredIsVerified: boolean,

    nextIsVerified: boolean,
  ): Promise<{ count: number }> {
    return this.prisma.deliveryPartner.updateMany({
      where: {
        id,

        // Prisma's BoolFilter has no `in` — a boolean only ever has the one required value to
        // condition on here (unlike the enum-status claims elsewhere in this file).
        isVerified: requiredIsVerified,
      },

      data: {
        isVerified: nextIsVerified,
      },
    });
  }

  /** EDPH-1 — personal details/addresses/emergency contact/languages, all optional/partial. */
  async updateProfile(userId: string, data: Record<string, unknown>) {
    return this.prisma.deliveryPartner.update({
      where: { userId },
      data,
    });
  }

  /**
   * Combines the exact `status` filter with the coarser `availability` filter (AVAILABLE vs
   * not) via AND rather than overwriting — an admin can legitimately supply both at once.
   */
  private buildAdminWhere(params: AdminDeliveryFilterParams): any {
    const where: any = {};
    const statusConditions: any[] = [];

    if (params.status) {
      statusConditions.push({ status: params.status });
    }

    if (params.availability === true) {
      statusConditions.push({ status: DeliveryPartnerStatus.AVAILABLE });
    } else if (params.availability === false) {
      statusConditions.push({
        status: { not: DeliveryPartnerStatus.AVAILABLE },
      });
    }

    if (statusConditions.length === 1) {
      Object.assign(where, statusConditions[0]);
    } else if (statusConditions.length > 1) {
      where.AND = statusConditions;
    }

    if (params.verified !== undefined) {
      where.isVerified = params.verified;
    }

    if (params.dateFrom || params.dateTo) {
      where.createdAt = {
        ...(params.dateFrom ? { gte: new Date(params.dateFrom) } : {}),

        ...(params.dateTo ? { lte: new Date(params.dateTo) } : {}),
      };
    }

    if (params.search) {
      where.OR = [
        { vehicleNumber: { contains: params.search, mode: 'insensitive' } },
        {
          user: { firstName: { contains: params.search, mode: 'insensitive' } },
        },
        {
          user: { lastName: { contains: params.search, mode: 'insensitive' } },
        },
        { user: { email: { contains: params.search, mode: 'insensitive' } } },
        { user: { phone: { contains: params.search, mode: 'insensitive' } } },
      ];
    }

    return where;
  }

  async findAllForAdmin(
    params: AdminDeliveryFilterParams & { skip: number; take: number },
  ): Promise<{ items: any[]; total: number }> {
    const where = this.buildAdminWhere(params);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.deliveryPartner.findMany({
        where,

        skip: params.skip,

        take: params.take,

        orderBy: {
          createdAt: 'desc',
        },

        include: {
          user: true,
        },
      }),

      this.prisma.deliveryPartner.count({
        where,
      }),
    ]);

    return { items, total };
  }

  /** Unpaginated — used only when the `online` filter is active, since live Redis presence can't be filtered in SQL. */
  async findAllMatchingForAdmin(
    params: AdminDeliveryFilterParams,
  ): Promise<any[]> {
    const where = this.buildAdminWhere(params);

    return this.prisma.deliveryPartner.findMany({
      where,

      orderBy: {
        createdAt: 'desc',
      },

      include: {
        user: true,
      },
    });
  }

  /**
   * Batched per-partner stats for a page of `userId`s — completed/today's delivery counts,
   * today's fee sum, and the current non-terminal order (if any). Three queries total
   * regardless of how many partners are on the page, not one query per partner.
   */
  async getDeliveryStatsForUserIds(
    userIds: string[],
  ): Promise<DeliveryPartnerStats> {
    if (userIds.length === 0) {
      return {
        completedDeliveries: new Map(),
        todaysDeliveries: new Map(),
        estimatedFeesToday: new Map(),
        currentOrder: new Map(),
      };
    }

    const [completedGroups, todaysGroups, currentOrders] = await Promise.all([
      this.prisma.order.groupBy({
        by: ['deliveryPartnerId'],

        where: {
          deliveryPartnerId: { in: userIds },

          status: OrderStatus.DELIVERED,
        },

        _count: {
          _all: true,
        },
      }),

      this.prisma.order.groupBy({
        by: ['deliveryPartnerId'],

        where: {
          deliveryPartnerId: { in: userIds },

          status: OrderStatus.DELIVERED,

          deliveredAt: { gte: startOfToday() },
        },

        _count: {
          _all: true,
        },

        _sum: {
          deliveryFee: true,
        },
      }),

      this.prisma.order.findMany({
        where: {
          deliveryPartnerId: { in: userIds },

          status: { in: NON_TERMINAL_ORDER_STATUSES },
        },

        orderBy: {
          createdAt: 'desc',
        },

        include: {
          restaurant: {
            select: {
              name: true,
            },
          },
        },
      }),
    ]);

    const completedDeliveries = new Map(
      completedGroups.map((group) => [
        group.deliveryPartnerId as string,
        group._count._all,
      ]),
    );

    const todaysDeliveries = new Map(
      todaysGroups.map((group) => [
        group.deliveryPartnerId as string,
        group._count._all,
      ]),
    );

    const estimatedFeesToday = new Map(
      todaysGroups.map((group) => [
        group.deliveryPartnerId as string,
        Number(group._sum.deliveryFee ?? 0),
      ]),
    );

    const currentOrder = new Map<
      string,
      {
        id: string;
        orderNumber: string;
        status: OrderStatus;
        restaurantName: string;
      }
    >();

    for (const order of currentOrders) {
      const partnerId = order.deliveryPartnerId;

      if (partnerId && !currentOrder.has(partnerId)) {
        currentOrder.set(partnerId, {
          id: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
          restaurantName: order.restaurant.name,
        });
      }
    }

    return {
      completedDeliveries,
      todaysDeliveries,
      estimatedFeesToday,
      currentOrder,
    };
  }

  /** Batched current-location lookup by DeliveryPartner id, for the admin "available partners"
   *  listing (`AdminDispatchService`) — kept separate from the richer getAllForAdmin projection
   *  above since that one doesn't expose raw lat/long. */
  async findLocationsByIds(
    ids: string[],
  ): Promise<
    Map<string, { latitude: number | null; longitude: number | null }>
  > {
    if (ids.length === 0) {
      return new Map();
    }

    const partners = await this.prisma.deliveryPartner.findMany({
      where: { id: { in: ids } },

      select: {
        id: true,
        currentLatitude: true,
        currentLongitude: true,
      },
    });

    return new Map(
      partners.map((partner) => [
        partner.id,
        {
          latitude: partner.currentLatitude,
          longitude: partner.currentLongitude,
        },
      ]),
    );
  }
}
