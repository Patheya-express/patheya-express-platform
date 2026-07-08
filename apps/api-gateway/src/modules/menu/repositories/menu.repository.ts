import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import { BaseRepository } from '../../../infrastructure/database/repositories/base.repository';

@Injectable()
export class MenuRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async createCategory(data: any) {
    return this.prisma.menuCategory.create({
      data,
    });
  }

  async createMenuItem(data: any) {
    return this.prisma.menuItem.create({
      data,
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
    return this.prisma.menuItem.update({
      where: {
        id: menuItemId,
      },

      data: dto,
    });
  }

  async deleteMenuItem(menuItemId: string) {
    return this.prisma.menuItem.delete({
      where: {
        id: menuItemId,
      },
    });
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
