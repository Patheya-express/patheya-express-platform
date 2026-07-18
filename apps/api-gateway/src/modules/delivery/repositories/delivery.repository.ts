import { Injectable } from '@nestjs/common';

import { DeliveryPartnerStatus, OrderStatus } from '@prisma/client';

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

  async updatePartnerStatusById(id: string, status: DeliveryPartnerStatus) {
    return this.prisma.deliveryPartner.update({
      where: {
        id,
      },

      data: {
        status,
      },
    });
  }

  async updateVerification(id: string, isVerified: boolean) {
    return this.prisma.deliveryPartner.update({
      where: {
        id,
      },

      data: {
        isVerified,
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
}
