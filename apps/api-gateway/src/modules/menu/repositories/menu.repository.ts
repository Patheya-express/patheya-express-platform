import { Injectable } from '@nestjs/common';

import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import { BaseRepository } from '../../../infrastructure/database/repositories/base.repository';

export const MENU_ITEM_SEARCH_INCLUDE = {
  category: {
    include: {
      restaurant: { select: { id: true, name: true, slug: true } },
    },
  },
} as const;

@Injectable()
export class MenuRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  /** Cross-restaurant menu item search (C7 global/menu search) — only surfaces items from approved, active restaurants. */
  async searchMenuItemsAcrossRestaurants(params: {
    search: string;
    skip: number;
    take: number;
  }) {
    const where: Prisma.MenuItemWhereInput = {
      isAvailable: true,
      name: { contains: params.search, mode: 'insensitive' },
      category: {
        isActive: true,
        restaurant: { status: 'APPROVED', isActive: true },
      },
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.menuItem.findMany({
        where,
        skip: params.skip,
        take: params.take,
        orderBy: { name: 'asc' },
        include: MENU_ITEM_SEARCH_INCLUDE,
      }),

      this.prisma.menuItem.count({ where }),
    ]);

    return { items, total };
  }

  /** Small, non-paginated set of name matches used for the live search-suggestions endpoint. */
  async findMenuItemNameMatches(search: string, limit: number) {
    return this.prisma.menuItem.findMany({
      where: {
        isAvailable: true,
        name: { contains: search, mode: 'insensitive' },
        category: {
          isActive: true,
          restaurant: { status: 'APPROVED', isActive: true },
        },
      },
      take: limit,
      orderBy: { name: 'asc' },
      include: MENU_ITEM_SEARCH_INCLUDE,
    });
  }

  async createCategory(data: any) {
    return this.prisma.menuCategory.create({
      data,
    });
  }

  async createMenuItem(data: any) {
    const menuItem = await this.prisma.menuItem.create({
      data,
    });

    const category = await this.prisma.menuCategory.findUnique({
      where: { id: menuItem.categoryId },
      select: { restaurantId: true },
    });

    if (category) {
      await this.recomputeVegFlags(category.restaurantId);
    }

    return menuItem;
  }

  /**
   * Restaurant.hasVegOptions/hasVeganOptions are a derived, denormalized summary of this
   * restaurant's menu — the same pattern already used for avgRating/avgDeliveryTimeMinutes.
   * Recomputed here (rather than on read) so every customer-facing restaurant filter/sort stays
   * a plain indexed boolean column instead of a per-request join.
   */
  private async recomputeVegFlags(restaurantId: string): Promise<void> {
    const [vegCount, veganCount] = await Promise.all([
      this.prisma.menuItem.count({
        where: { category: { restaurantId }, isVegetarian: true },
      }),
      this.prisma.menuItem.count({
        where: { category: { restaurantId }, isVegan: true },
      }),
    ]);

    await this.prisma.restaurant.update({
      where: { id: restaurantId },
      data: {
        hasVegOptions: vegCount > 0,
        hasVeganOptions: veganCount > 0,
      },
    });
  }

  async getRestaurantMenu(restaurantId: string, search?: string) {
    return this.prisma.menuCategory.findMany({
      where: {
        restaurantId,

        isActive: true,
      },

      orderBy: {
        sortOrder: 'asc',
      },

      include: {
        menuItems: {
          where: {
            isAvailable: true,

            ...(search
              ? {
                  name: {
                    contains: search,

                    mode: 'insensitive',
                  },
                }
              : {}),
          },

          include: {
            variants: true,

            addons: {
              include: {
                options: true,
              },
            },
          },
        },
      },
    });
  }
  async getMenuItemById(menuItemId: string) {
    return this.prisma.menuItem.findUnique({
      where: {
        id: menuItemId,
      },
    });
  }

  async updateMenuItem(
    menuItemId: string,

    dto: any,
  ) {
    const updated = await this.prisma.menuItem.update({
      where: {
        id: menuItemId,
      },

      data: dto,
    });

    if (dto.isVegetarian !== undefined || dto.isVegan !== undefined) {
      const category = await this.prisma.menuCategory.findUnique({
        where: { id: updated.categoryId },
        select: { restaurantId: true },
      });

      if (category) {
        await this.recomputeVegFlags(category.restaurantId);
      }
    }

    return updated;
  }

  async deleteMenuItem(menuItemId: string) {
    const existing = await this.prisma.menuItem.findUnique({
      where: { id: menuItemId },
      select: {
        categoryId: true,
        isVegetarian: true,
        isVegan: true,
        category: { select: { restaurantId: true } },
      },
    });

    const deleted = await this.prisma.menuItem.delete({
      where: {
        id: menuItemId,
      },
    });

    if (existing && (existing.isVegetarian || existing.isVegan)) {
      await this.recomputeVegFlags(existing.category.restaurantId);
    }

    return deleted;
  }

  async toggleAvailability(
    menuItemId: string,

    isAvailable: boolean,
  ) {
    return this.prisma.menuItem.update({
      where: {
        id: menuItemId,
      },

      data: {
        isAvailable,
      },
    });
  }
  async getCategoryById(categoryId: string) {
    return this.prisma.menuCategory.findUnique({
      where: {
        id: categoryId,
      },
    });
  }

  async updateCategory(
    categoryId: string,

    dto: any,
  ) {
    return this.prisma.menuCategory.update({
      where: {
        id: categoryId,
      },

      data: dto,
    });
  }

  async deleteCategory(categoryId: string) {
    return this.prisma.menuCategory.delete({
      where: {
        id: categoryId,
      },
    });
  }
  async createVariant(
    menuItemId: string,

    dto: any,
  ) {
    return this.prisma.menuItemVariant.create({
      data: {
        menuItemId,

        ...dto,
      },
    });
  }

  async updateVariant(
    variantId: string,

    dto: any,
  ) {
    return this.prisma.menuItemVariant.update({
      where: {
        id: variantId,
      },

      data: dto,
    });
  }

  async deleteVariant(variantId: string) {
    return this.prisma.menuItemVariant.delete({
      where: {
        id: variantId,
      },
    });
  }
  async createAddon(menuItemId: string, dto: any) {
    return this.prisma.menuItemAddon.create({
      data: {
        menuItemId,
        ...dto,
      },
    });
  }

  async updateAddon(addonId: string, dto: any) {
    return this.prisma.menuItemAddon.update({
      where: {
        id: addonId,
      },
      data: dto,
    });
  }

  async deleteAddon(addonId: string) {
    return this.prisma.menuItemAddon.delete({
      where: {
        id: addonId,
      },
    });
  }

  async createAddonOption(addonId: string, dto: any) {
    return this.prisma.menuItemAddonOption.create({
      data: {
        addonId,
        ...dto,
      },
    });
  }

  async updateAddonOption(optionId: string, dto: any) {
    return this.prisma.menuItemAddonOption.update({
      where: {
        id: optionId,
      },
      data: dto,
    });
  }

  async deleteAddonOption(optionId: string) {
    return this.prisma.menuItemAddonOption.delete({
      where: {
        id: optionId,
      },
    });
  }
  async getVariantById(variantId: string) {
    return this.prisma.menuItemVariant.findUnique({
      where: {
        id: variantId,
      },
    });
  }

  async getAddonById(addonId: string) {
    return this.prisma.menuItemAddon.findUnique({
      where: {
        id: addonId,
      },

      include: {
        options: true,
      },
    });
  }

  async getAddonOptionById(optionId: string) {
    return this.prisma.menuItemAddonOption.findUnique({
      where: {
        id: optionId,
      },
    });
  }
}
