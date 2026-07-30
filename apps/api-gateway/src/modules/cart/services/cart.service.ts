import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import { CartRepository } from '../repositories/cart.repository';

import { AddCartItemDto } from '../dto/add-cart-item.dto';
import { UpdateCartItemDto } from '../dto/update-cart-item.dto';
import { CartResponseDto } from '../dto/cart-response.dto';

/**
 * Cart prices are always computed live from the current menu — never snapshotted — so the
 * displayed total reflects reality even if a restaurant changes prices while items sit in the
 * cart. The authoritative charge is still recomputed independently at order placement.
 */
function toCartResponse(cart: any): CartResponseDto {
  let subtotal = 0;
  let totalItems = 0;

  const items = cart.items.map((item: any) => {
    const unitPrice = item.variant
      ? Number(item.variant.price)
      : Number(item.menuItem.basePrice);

    const addonOptions = item.addonOptions.map((entry: any) => ({
      id: entry.addonOption.id,
      name: entry.addonOption.name,
      price: Number(entry.addonOption.price),
    }));

    const addonsTotal = addonOptions.reduce(
      (sum: number, option: any) => sum + option.price,
      0,
    );

    const lineTotal = (unitPrice + addonsTotal) * item.quantity;

    subtotal += lineTotal;
    totalItems += item.quantity;

    return {
      id: item.id,
      menuItemId: item.menuItemId,
      name: item.menuItem.name,
      imageUrl: item.menuItem.imageUrl ?? undefined,
      variantId: item.variantId ?? undefined,
      variantName: item.variant?.name,
      unitPrice,
      addonOptions,
      quantity: item.quantity,
      lineTotal,
      specialInstructions: item.specialInstructions ?? undefined,
      isAvailable: item.menuItem.isAvailable,
    };
  });

  return {
    id: cart.id,
    restaurantId: cart.restaurantId ?? undefined,
    restaurantName: cart.restaurant?.name,
    items,
    subtotal,
    totalItems,
  };
}

@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cartRepository: CartRepository,
  ) {}

  async getCart(customerId: string): Promise<CartResponseDto> {
    const cart = await this.cartRepository.findOrCreateCart(customerId);

    return toCartResponse(cart);
  }

  async addItem(
    customerId: string,
    dto: AddCartItemDto,
  ): Promise<CartResponseDto> {
    const menuItem = await this.prisma.menuItem.findUnique({
      where: { id: dto.menuItemId },
      include: {
        category: true,
        variants: true,
        addons: { include: { options: true } },
      },
    });

    if (!menuItem) {
      throw new NotFoundException('Menu item not found');
    }

    if (!menuItem.isAvailable) {
      throw new BadRequestException('This item is currently unavailable');
    }

    if (
      dto.variantId &&
      !menuItem.variants.some((variant) => variant.id === dto.variantId)
    ) {
      throw new BadRequestException(
        'Variant does not belong to this menu item',
      );
    }

    const validOptionIds = new Set(
      menuItem.addons.flatMap((addon) =>
        addon.options.map((option) => option.id),
      ),
    );

    for (const optionId of dto.addonOptionIds ?? []) {
      if (!validOptionIds.has(optionId)) {
        throw new BadRequestException(
          'Addon option does not belong to this menu item',
        );
      }
    }

    const restaurantId = menuItem.category.restaurantId;

    const cart = await this.cartRepository.findOrCreateCart(customerId);

    const hasConflict =
      cart.items.length > 0 &&
      cart.restaurantId != null &&
      cart.restaurantId !== restaurantId;

    if (hasConflict && !dto.replaceExisting) {
      throw new ConflictException(
        'Cart contains items from a different restaurant',
      );
    }

    if (hasConflict && dto.replaceExisting) {
      await this.cartRepository.clearItems(cart.id);

      cart.items = [];
    }

    if (cart.restaurantId !== restaurantId) {
      await this.cartRepository.setCartRestaurant(cart.id, restaurantId);
    }

    const addonOptionIds = dto.addonOptionIds ?? [];
    const addonSet = new Set(addonOptionIds);

    const existingItem = cart.items.find(
      (item: any) =>
        item.menuItemId === dto.menuItemId &&
        (item.variantId ?? null) === (dto.variantId ?? null) &&
        item.addonOptions.length === addonSet.size &&
        item.addonOptions.every((entry: any) =>
          addonSet.has(entry.addonOptionId),
        ),
    );

    if (existingItem) {
      await this.cartRepository.updateQuantity(
        existingItem.id,
        existingItem.quantity + dto.quantity,
      );
    } else {
      await this.cartRepository.addItem(cart.id, {
        menuItemId: dto.menuItemId,
        variantId: dto.variantId,
        quantity: dto.quantity,
        specialInstructions: dto.specialInstructions,
        addonOptionIds,
      });
    }

    return this.getCart(customerId);
  }

  async updateItemQuantity(
    customerId: string,
    cartItemId: string,
    dto: UpdateCartItemDto,
  ): Promise<CartResponseDto> {
    const cart = await this.cartRepository.findOrCreateCart(customerId);

    const item = await this.cartRepository.findCartItem(cartItemId, cart.id);

    if (!item) {
      throw new NotFoundException('Cart item not found');
    }

    await this.cartRepository.updateQuantity(cartItemId, dto.quantity);

    return this.getCart(customerId);
  }

  async removeItem(
    customerId: string,
    cartItemId: string,
  ): Promise<CartResponseDto> {
    const cart = await this.cartRepository.findOrCreateCart(customerId);

    const item = await this.cartRepository.findCartItem(cartItemId, cart.id);

    if (!item) {
      throw new NotFoundException('Cart item not found');
    }

    await this.cartRepository.removeItem(cartItemId);

    return this.getCart(customerId);
  }

  async clearCart(customerId: string): Promise<CartResponseDto> {
    const cart = await this.cartRepository.findOrCreateCart(customerId);

    await this.cartRepository.clearItems(cart.id);

    return this.getCart(customerId);
  }
}
