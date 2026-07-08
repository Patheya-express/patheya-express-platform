import { Injectable } from '@nestjs/common';

import { RestaurantStatus } from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import { BaseRepository } from '../../../infrastructure/database/repositories/base.repository';

export interface FindAllRestaurantsForAdminParams {
  skip: number;
  take: number;
  search?: string;
  city?: string;
  cuisine?: string;
  status?: RestaurantStatus;
}

@Injectable()
export class RestaurantsRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async createRestaurant(data: any) {
    return this.prisma.restaurant.create({
      data,
    });
  }

  async findRestaurantsByOwner(ownerId: string) {
    return this.prisma.restaurant.findMany({
      where: {
        ownerId,
      },

      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findRestaurantById(restaurantId: string) {
    return this.prisma.restaurant.findUnique({
      where: {
        id: restaurantId,
      },

      include: {
        cuisines: { include: { cuisine: true } },

        branches: { include: { operatingHours: true } },
      },
    });
  }

  async countByStatus(status?: RestaurantStatus): Promise<number> {
    return this.prisma.restaurant.count({
      where: status ? { status } : {},
    });
  }

  /**
   * Admin-facing platform-wide listing. Unlike the public findAll (which hardcodes
   * APPROVED + isActive), this returns every status by default and supports filtering by
   * any of them explicitly. City/cuisine filter through their relations — a restaurant's
   * "city" lives on its branches, and "cuisine" through the RestaurantCuisine join table.
   */
  async findAllForAdmin(
    params: FindAllRestaurantsForAdminParams,
  ): Promise<{ items: any[]; total: number }> {
    const where: any = {};

    if (params.status) {
      where.status = params.status;
    }

    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: 'insensitive' } },
        {
          owner: {
            firstName: { contains: params.search, mode: 'insensitive' },
          },
        },
        {
          owner: { lastName: { contains: params.search, mode: 'insensitive' } },
        },
        { owner: { email: { contains: params.search, mode: 'insensitive' } } },
      ];
    }

    if (params.city) {
      where.branches = {
        some: {
          city: { contains: params.city, mode: 'insensitive' },
        },
      };
    }

    if (params.cuisine) {
      where.cuisines = {
        some: {
          cuisine: {
            name: { contains: params.cuisine, mode: 'insensitive' },
          },
        },
      };
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.restaurant.findMany({
        where,

        skip: params.skip,

        take: params.take,

        orderBy: {
          createdAt: 'desc',
        },

        include: {
          owner: true,

          branches: {
            select: {
              city: true,
            },
          },

          cuisines: {
            include: {
              cuisine: true,
            },
          },
        },
      }),

      this.prisma.restaurant.count({
        where,
      }),
    ]);

    return { items, total };
  }

  async updateStatus(restaurantId: string, status: RestaurantStatus) {
    return this.prisma.restaurant.update({
      where: {
        id: restaurantId,
      },

      data: {
        status,
      },
    });
  }

  async updateImages(
    restaurantId: string,

    data: { logoUrl?: string; bannerUrl?: string },
  ) {
    return this.prisma.restaurant.update({
      where: {
        id: restaurantId,
      },

      data,
    });
  }

  /**
   * Incremental mean update (avgNew = avgOld + (value - avgOld) / newCount) — avoids
   * re-aggregating every historical order's timing on each delivery, which would get more
   * expensive as order history grows. `deliveredOrderCount` is the running sample size backing
   * both averages.
   */
  async recordOrderTiming(
    restaurantId: string,

    prepMinutes: number | null,

    deliveryMinutes: number,
  ) {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: {
        avgPreparationTimeMinutes: true,
        avgDeliveryTimeMinutes: true,
        deliveredOrderCount: true,
      },
    });

    if (!restaurant) {
      return;
    }

    const newCount = restaurant.deliveredOrderCount + 1;

    const newAvgDelivery =
      (restaurant.avgDeliveryTimeMinutes ?? deliveryMinutes) +
      (deliveryMinutes -
        (restaurant.avgDeliveryTimeMinutes ?? deliveryMinutes)) /
        newCount;

    const newAvgPrep =
      prepMinutes === null
        ? restaurant.avgPreparationTimeMinutes
        : (restaurant.avgPreparationTimeMinutes ?? prepMinutes) +
          (prepMinutes -
            (restaurant.avgPreparationTimeMinutes ?? prepMinutes)) /
            newCount;

    return this.prisma.restaurant.update({
      where: { id: restaurantId },
      data: {
        deliveredOrderCount: newCount,
        avgDeliveryTimeMinutes: Math.round(newAvgDelivery),
        avgPreparationTimeMinutes:
          newAvgPrep === null ? null : Math.round(newAvgPrep),
      },
    });
  }
}
