import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import { BaseRepository } from '../../../infrastructure/database/repositories/base.repository';

import { RESTAURANT_SUMMARY_INCLUDE } from '../../restaurants/services/restaurants.service';

export const FAVORITE_MENU_ITEM_INCLUDE = {
  variants: true,

  addons: {
    include: {
      options: true,
    },
  },

  category: {
    select: {
      restaurantId: true,

      restaurant: {
        select: { name: true },
      },
    },
  },
} as const;

@Injectable()
export class FavoritesRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async addRestaurantFavorite(customerId: string, restaurantId: string) {
    await this.prisma.restaurantFavorite.upsert({
      where: {
        customerId_restaurantId: { customerId, restaurantId },
      },

      update: {},

      create: { customerId, restaurantId },
    });
  }

  async removeRestaurantFavorite(customerId: string, restaurantId: string) {
    await this.prisma.restaurantFavorite.deleteMany({
      where: { customerId, restaurantId },
    });
  }

  async addMenuItemFavorite(customerId: string, menuItemId: string) {
    await this.prisma.menuItemFavorite.upsert({
      where: {
        customerId_menuItemId: { customerId, menuItemId },
      },

      update: {},

      create: { customerId, menuItemId },
    });
  }

  async removeMenuItemFavorite(customerId: string, menuItemId: string) {
    await this.prisma.menuItemFavorite.deleteMany({
      where: { customerId, menuItemId },
    });
  }

  async findFavoriteRestaurantsDetailed(
    customerId: string,

    skip: number,

    take: number,
  ) {
    const [favorites, total] = await this.prisma.$transaction([
      this.prisma.restaurantFavorite.findMany({
        where: { customerId },

        orderBy: { createdAt: 'desc' },

        skip,

        take,

        select: { restaurantId: true },
      }),

      this.prisma.restaurantFavorite.count({ where: { customerId } }),
    ]);

    const ids = favorites.map((f) => f.restaurantId);

    if (ids.length === 0) {
      return { items: [], total };
    }

    const restaurants = await this.prisma.restaurant.findMany({
      where: { id: { in: ids } },

      include: RESTAURANT_SUMMARY_INCLUDE,
    });

    const byId = new Map(restaurants.map((r) => [r.id, r]));

    const items = ids
      .map((id) => byId.get(id))
      .filter((r): r is NonNullable<typeof r> => r != null);

    return { items, total };
  }

  async findFavoriteMenuItemsDetailed(
    customerId: string,

    skip: number,

    take: number,
  ) {
    const [favorites, total] = await this.prisma.$transaction([
      this.prisma.menuItemFavorite.findMany({
        where: { customerId },

        orderBy: { createdAt: 'desc' },

        skip,

        take,

        select: { menuItemId: true },
      }),

      this.prisma.menuItemFavorite.count({ where: { customerId } }),
    ]);

    const ids = favorites.map((f) => f.menuItemId);

    if (ids.length === 0) {
      return { items: [], total };
    }

    const menuItems = await this.prisma.menuItem.findMany({
      where: { id: { in: ids } },

      include: FAVORITE_MENU_ITEM_INCLUDE,
    });

    const byId = new Map(menuItems.map((m) => [m.id, m]));

    const items = ids
      .map((id) => byId.get(id))
      .filter((m): m is NonNullable<typeof m> => m != null);

    return { items, total };
  }

  async getFavoritedRestaurantIds(
    customerId: string,

    restaurantIds: string[],
  ): Promise<Set<string>> {
    if (restaurantIds.length === 0) {
      return new Set();
    }

    const favorites = await this.prisma.restaurantFavorite.findMany({
      where: { customerId, restaurantId: { in: restaurantIds } },

      select: { restaurantId: true },
    });

    return new Set(favorites.map((f) => f.restaurantId));
  }

  async getFavoritedMenuItemIds(
    customerId: string,

    menuItemIds: string[],
  ): Promise<Set<string>> {
    if (menuItemIds.length === 0) {
      return new Set();
    }

    const favorites = await this.prisma.menuItemFavorite.findMany({
      where: { customerId, menuItemId: { in: menuItemIds } },

      select: { menuItemId: true },
    });

    return new Set(favorites.map((f) => f.menuItemId));
  }
}
