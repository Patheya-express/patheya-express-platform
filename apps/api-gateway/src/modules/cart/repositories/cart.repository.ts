import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import { BaseRepository } from '../../../infrastructure/database/repositories/base.repository';

export const CART_INCLUDE = {
  restaurant: {
    select: { name: true },
  },
  items: {
    include: {
      menuItem: true,
      variant: true,
      addonOptions: {
        include: {
          addonOption: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' as const },
  },
} as const;

@Injectable()
export class CartRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async findOrCreateCart(customerId: string) {
    return this.prisma.cart.upsert({
      where: { customerId },
      update: {},
      create: { customerId },
      include: CART_INCLUDE,
    });
  }

  async findCartItem(cartItemId: string, cartId: string) {
    return this.prisma.cartItem.findFirst({
      where: { id: cartItemId, cartId },
    });
  }

  async setCartRestaurant(cartId: string, restaurantId: string) {
    return this.prisma.cart.update({
      where: { id: cartId },
      data: { restaurantId },
    });
  }

  async clearItems(cartId: string) {
    return this.prisma.cartItem.deleteMany({ where: { cartId } });
  }

  async addItem(
    cartId: string,
    data: {
      menuItemId: string;
      variantId?: string;
      quantity: number;
      specialInstructions?: string;
      addonOptionIds: string[];
    },
  ) {
    return this.prisma.cartItem.create({
      data: {
        cartId,
        menuItemId: data.menuItemId,
        variantId: data.variantId,
        quantity: data.quantity,
        specialInstructions: data.specialInstructions,
        addonOptions: {
          create: data.addonOptionIds.map((addonOptionId) => ({
            addonOptionId,
          })),
        },
      },
    });
  }

  async updateQuantity(cartItemId: string, quantity: number) {
    return this.prisma.cartItem.update({
      where: { id: cartItemId },
      data: { quantity },
    });
  }

  async removeItem(cartItemId: string) {
    return this.prisma.cartItem.delete({ where: { id: cartItemId } });
  }
}
