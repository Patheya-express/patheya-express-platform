import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import { BaseRepository } from '../../../infrastructure/database/repositories/base.repository';
import { OrderStatus, PaymentStatus } from '@prisma/client';

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
        items: true,
      },
    });
  }

  async findCustomerOrders(customerId: string) {
    return this.prisma.order.findMany({
      where: {
        customerId,
      },

      include: {
        items: true,

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
    });
  }

  async findRestaurantOrders(restaurantId: string) {
    return this.prisma.order.findMany({
      where: {
        restaurantId,
      },

      include: {
        items: {
          include: {
            menuItem: {
              select: {
                name: true,
              },
            },
          },
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
          include: {
            menuItem: {
              select: {
                name: true,
              },
            },
          },
        },

        statusHistory: {
          orderBy: {
            createdAt: 'asc',
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
  async findAllForAdmin(params: FindAllOrdersForAdminParams): Promise<{ items: any[]; total: number }> {
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
        { customer: { firstName: { contains: params.search, mode: 'insensitive' } } },
        { customer: { lastName: { contains: params.search, mode: 'insensitive' } } },
        { customer: { email: { contains: params.search, mode: 'insensitive' } } },
        { restaurant: { name: { contains: params.search, mode: 'insensitive' } } },
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
            include: {
              menuItem: {
                select: {
                  name: true,
                },
              },
            },
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
}
