import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import { BaseRepository } from '../../../infrastructure/database/repositories/base.repository';
import { OrderStatus, PaymentStatus } from '@prisma/client';

const ORDER_ITEM_INCLUDE = {
  menuItem: {
    select: { name: true },
  },
  variant: {
    select: { name: true },
  },
  addonOptions: true,
} as const;

const ACTIVE_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.PENDING,
  OrderStatus.CONFIRMED,
  OrderStatus.PREPARING,
  OrderStatus.READY_FOR_PICKUP,
  OrderStatus.OUT_FOR_DELIVERY,
];

export interface FindAllOrdersForAdminParams {
  skip: number;
  take: number;
  search?: string;
  status?: OrderStatus;
  restaurantId?: string;
  customerId?: string;
  deliveryPartnerId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface FindCustomerOrdersParams {
  customerId: string;
  skip: number;
  take: number;
  search?: string;
  status?: OrderStatus;
  dateFrom?: string;
  dateTo?: string;
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

@Injectable()
export class OrdersRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async createOrder(data: any) {
    return this.prisma.order.create({
      data,

      include: {
        items: {
          include: ORDER_ITEM_INCLUDE,
        },
      },
    });
  }

  /**
   * Paginated, filterable order history for the customer-facing "my orders" screen — mirrors
   * the shape of findAllForAdmin but pre-scoped to a single customerId (never accepts one as a
   * caller-supplied filter, since that's the whole point of this method vs. the admin one).
   */
  async findCustomerOrders(
    params: FindCustomerOrdersParams,
  ): Promise<{ items: any[]; total: number }> {
    const where: any = { customerId: params.customerId };

    if (params.status) {
      where.status = params.status;
    }

    if (params.dateFrom || params.dateTo) {
      where.placedAt = {
        ...(params.dateFrom ? { gte: new Date(params.dateFrom) } : {}),
        ...(params.dateTo ? { lte: new Date(params.dateTo) } : {}),
      };
    }

    if (params.search) {
      where.OR = [
        { orderNumber: { contains: params.search, mode: 'insensitive' } },
        {
          restaurant: {
            name: { contains: params.search, mode: 'insensitive' },
          },
        },
      ];
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,

        skip: params.skip,

        take: params.take,

        include: {
          items: {
            include: ORDER_ITEM_INCLUDE,
          },

          restaurant: true,

          statusHistory: {
            orderBy: {
              createdAt: 'asc',
            },
          },
        },

        orderBy: {
          createdAt: 'desc',
        },
      }),

      this.prisma.order.count({ where }),
    ]);

    return { items, total };
  }

  /** Lightweight ownership projection — used by authorization checks that don't need the full order graph. */
  async findOrderOwnership(orderId: string) {
    return this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        customerId: true,
        restaurantId: true,
        deliveryPartnerId: true,
        status: true,
        latitude: true,
        longitude: true,
      },
    });
  }

  async findRestaurantOrders(restaurantId: string) {
    return this.prisma.order.findMany({
      where: {
        restaurantId,
      },

      include: {
        items: {
          include: ORDER_ITEM_INCLUDE,
        },

        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },

      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async updateOrderStatus(
    orderId: string,

    status: any,
  ) {
    return this.prisma.order.update({
      where: {
        id: orderId,
      },

      data: {
        status,

        ...(status === OrderStatus.DELIVERED
          ? { deliveredAt: new Date() }
          : {}),
      },
    });
  }

  /**
   * Atomic compare-and-swap transition: only succeeds if the order is still PENDING at the
   * moment of the update. Used by the order-acceptance-timeout job so a timeout firing at the
   * same moment a restaurant manually accepts/rejects can never double-apply — exactly one of
   * the two writers wins, and the loser gets `null` back and takes no further action.
   */
  async transitionIfPending(orderId: string, status: OrderStatus) {
    const result = await this.prisma.order.updateMany({
      where: {
        id: orderId,
        status: OrderStatus.PENDING,
      },

      data: {
        status,
      },
    });

    if (result.count === 0) {
      return null;
    }

    return this.findOrderById(orderId);
  }

  async createStatusHistory(data: any) {
    return this.prisma.orderStatusHistory.create({
      data,
    });
  }
  async findOrderById(orderId: string) {
    return this.prisma.order.findUnique({
      where: {
        id: orderId,
      },

      include: {
        items: {
          include: ORDER_ITEM_INCLUDE,
        },

        statusHistory: {
          orderBy: {
            createdAt: 'asc',
          },
        },

        deliveryPartner: {
          include: {
            deliveryPartnerProfile: true,
          },
        },
      },
    });
  }

  async assignDeliveryPartner(
    orderId: string,

    deliveryPartnerId: string,
  ) {
    return this.prisma.order.update({
      where: {
        id: orderId,
      },

      data: {
        deliveryPartnerId,
      },
    });
  }

  async getOrderTimeline(orderId: string) {
    return this.prisma.orderStatusHistory.findMany({
      where: {
        orderId,
      },

      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  async findStatusHistoryEntry(orderId: string, status: OrderStatus) {
    return this.prisma.orderStatusHistory.findFirst({
      where: {
        orderId,
        status,
      },

      orderBy: {
        createdAt: 'asc',
      },
    });
  }
  async markDelivered(orderId: string) {
    return this.prisma.order.update({
      where: {
        id: orderId,
      },

      data: {
        status: OrderStatus.DELIVERED,

        deliveredAt: new Date(),
      },
    });
  }

  async countPlacedToday(): Promise<number> {
    return this.prisma.order.count({
      where: {
        placedAt: {
          gte: startOfToday(),
        },
      },
    });
  }

  async countActive(): Promise<number> {
    return this.prisma.order.count({
      where: {
        status: {
          in: ACTIVE_ORDER_STATUSES,
        },
      },
    });
  }

  async countDeliveredToday(): Promise<number> {
    return this.prisma.order.count({
      where: {
        status: OrderStatus.DELIVERED,

        deliveredAt: {
          gte: startOfToday(),
        },
      },
    });
  }

  /**
   * Platform-wide, filterable order listing for admin use. Includes customer, restaurant,
   * and delivery partner summaries plus the most recent payment attempt — none of which the
   * customer/restaurant-scoped queries above fetch, since those callers already know who
   * they are and don't need it echoed back.
   */
  async findAllForAdmin(
    params: FindAllOrdersForAdminParams,
  ): Promise<{ items: any[]; total: number }> {
    const where: any = {};

    if (params.status) {
      where.status = params.status;
    }

    if (params.restaurantId) {
      where.restaurantId = params.restaurantId;
    }

    if (params.customerId) {
      where.customerId = params.customerId;
    }

    if (params.deliveryPartnerId) {
      where.deliveryPartnerId = params.deliveryPartnerId;
    }

    if (params.dateFrom || params.dateTo) {
      where.placedAt = {
        ...(params.dateFrom ? { gte: new Date(params.dateFrom) } : {}),

        ...(params.dateTo ? { lte: new Date(params.dateTo) } : {}),
      };
    }

    if (params.search) {
      where.OR = [
        { orderNumber: { contains: params.search, mode: 'insensitive' } },
        {
          customer: {
            firstName: { contains: params.search, mode: 'insensitive' },
          },
        },
        {
          customer: {
            lastName: { contains: params.search, mode: 'insensitive' },
          },
        },
        {
          customer: { email: { contains: params.search, mode: 'insensitive' } },
        },
        {
          restaurant: {
            name: { contains: params.search, mode: 'insensitive' },
          },
        },
      ];
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,

        skip: params.skip,

        take: params.take,

        orderBy: {
          createdAt: 'desc',
        },

        include: {
          customer: true,

          restaurant: {
            select: {
              id: true,
              name: true,
            },
          },

          deliveryPartner: true,

          items: {
            include: ORDER_ITEM_INCLUDE,
          },

          statusHistory: {
            orderBy: {
              createdAt: 'asc',
            },
          },

          payment: {
            orderBy: {
              createdAt: 'desc',
            },

            take: 1,
          },
        },
      }),

      this.prisma.order.count({
        where,
      }),
    ]);

    return { items, total };
  }

  async updatePaymentStatus(orderId: string, paymentStatus: PaymentStatus) {
    return this.prisma.order.update({
      where: {
        id: orderId,
      },

      data: {
        paymentStatus,
      },
    });
  }

  /**
   * Everything the restaurant dashboard needs, fetched with server-side aggregation only —
   * bounded to this restaurant (indexed) and a 30-day window, never the restaurant's entire
   * order history. `orderId`-scoped in-memory grouping for "today" counts and peak-hours is done
   * over this already-small, already-filtered set, which is not the client-side-aggregation
   * anti-pattern the platform is moving away from (that pattern was shipping *all* of a
   * restaurant's orders to the frontend for it to reduce — this stays entirely server-side and
   * only the final aggregated numbers cross the wire).
   */
  async getDashboardWindowOrders(
    restaurantId: string,
    since: Date,
    branchId?: string,
  ) {
    return this.prisma.order.findMany({
      where: {
        restaurantId,
        ...(branchId ? { branchId } : {}),
        placedAt: { gte: since },
      },
      select: {
        id: true,
        status: true,
        totalAmount: true,
        placedAt: true,
        statusHistory: {
          where: { status: OrderStatus.READY_FOR_PICKUP },
          select: { createdAt: true },
          take: 1,
        },
      },
    });
  }

  async getTopSellingItems(
    restaurantId: string,
    since: Date,
    take: number,
    branchId?: string,
  ) {
    const grouped = await this.prisma.orderItem.groupBy({
      by: ['menuItemId'],
      where: {
        order: {
          restaurantId,
          ...(branchId ? { branchId } : {}),
          placedAt: { gte: since },
        },
      },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take,
    });

    const menuItems = await this.prisma.menuItem.findMany({
      where: { id: { in: grouped.map((entry) => entry.menuItemId) } },
      select: { id: true, name: true },
    });

    const nameById = new Map(menuItems.map((item) => [item.id, item.name]));

    return grouped.map((entry) => ({
      menuItemId: entry.menuItemId,
      name: nameById.get(entry.menuItemId) ?? 'Unknown item',
      quantitySold: entry._sum.quantity ?? 0,
    }));
  }

  async getRecentOrders(restaurantId: string, take: number, branchId?: string) {
    return this.prisma.order.findMany({
      where: {
        restaurantId,
        ...(branchId ? { branchId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        totalAmount: true,
        createdAt: true,
        customer: { select: { firstName: true, lastName: true } },
      },
    });
  }
}
