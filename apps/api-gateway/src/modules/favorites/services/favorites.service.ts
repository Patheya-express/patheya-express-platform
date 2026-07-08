import { Injectable, NotFoundException } from '@nestjs/common';

import { Prisma } from '@prisma/client';

import {
  FavoritesRepository,
  FAVORITE_MENU_ITEM_INCLUDE,
} from '../repositories/favorites.repository';

import { GetFavoritesQueryDto } from '../dto/get-favorites-query.dto';
import { FavoriteToggleResponseDto } from '../dto/favorite-toggle-response.dto';
import { FavoriteStatusItemDto } from '../dto/favorite-status-item.dto';
import { PaginatedFavoriteMenuItemsResponseDto } from '../dto/paginated-favorite-menu-items-response.dto';

import { PaginatedRestaurantSummariesResponseDto } from '../../restaurants/dto/paginated-restaurant-summaries-response.dto';
import { MenuItemResponseDto } from '../../menu/dto/menu-item-response.dto';

import { toRestaurantSummary } from '../../restaurants/services/restaurants.service';

const FOREIGN_KEY_VIOLATION = 'P2003';

type FavoriteMenuItemRow = Prisma.MenuItemGetPayload<{
  include: typeof FAVORITE_MENU_ITEM_INCLUDE;
}>;

function toFavoriteMenuItemResponse(
  item: FavoriteMenuItemRow,
): MenuItemResponseDto {
  return {
    id: item.id,
    categoryId: item.categoryId,
    name: item.name,
    description: item.description ?? undefined,
    basePrice: Number(item.basePrice),
    imageUrl: item.imageUrl ?? undefined,
    isVegetarian: item.isVegetarian,
    isVegan: item.isVegan,
    isAvailable: item.isAvailable,
    variants: item.variants.map((variant) => ({
      id: variant.id,
      menuItemId: variant.menuItemId,
      name: variant.name,
      price: Number(variant.price),
      isDefault: variant.isDefault,
    })),
    addons: item.addons.map((addon) => ({
      id: addon.id,
      menuItemId: addon.menuItemId,
      name: addon.name,
      minSelection: addon.minSelection,
      maxSelection: addon.maxSelection,
      options: addon.options.map((option) => ({
        id: option.id,
        addonId: option.addonId,
        name: option.name,
        price: Number(option.price),
        isAvailable: option.isAvailable,
      })),
    })),
    restaurantId: item.category?.restaurantId,
    restaurantName: item.category?.restaurant?.name,
  };
}

function parseIds(raw: string): string[] {
  return raw
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

@Injectable()
export class FavoritesService {
  constructor(private readonly favoritesRepository: FavoritesRepository) {}

  async addRestaurantFavorite(
    customerId: string,

    restaurantId: string,
  ): Promise<FavoriteToggleResponseDto> {
    try {
      await this.favoritesRepository.addRestaurantFavorite(
        customerId,

        restaurantId,
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === FOREIGN_KEY_VIOLATION
      ) {
        throw new NotFoundException('Restaurant not found');
      }

      throw error;
    }

    return { success: true, isFavorited: true };
  }

  async removeRestaurantFavorite(
    customerId: string,

    restaurantId: string,
  ): Promise<FavoriteToggleResponseDto> {
    await this.favoritesRepository.removeRestaurantFavorite(
      customerId,

      restaurantId,
    );

    return { success: true, isFavorited: false };
  }

  async addMenuItemFavorite(
    customerId: string,

    menuItemId: string,
  ): Promise<FavoriteToggleResponseDto> {
    try {
      await this.favoritesRepository.addMenuItemFavorite(
        customerId,

        menuItemId,
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === FOREIGN_KEY_VIOLATION
      ) {
        throw new NotFoundException('Menu item not found');
      }

      throw error;
    }

    return { success: true, isFavorited: true };
  }

  async removeMenuItemFavorite(
    customerId: string,

    menuItemId: string,
  ): Promise<FavoriteToggleResponseDto> {
    await this.favoritesRepository.removeMenuItemFavorite(
      customerId,

      menuItemId,
    );

    return { success: true, isFavorited: false };
  }

  async getFavoriteRestaurants(
    customerId: string,

    query: GetFavoritesQueryDto,
  ): Promise<PaginatedRestaurantSummariesResponseDto> {
    const skip = (query.page - 1) * query.limit;

    const { items, total } =
      await this.favoritesRepository.findFavoriteRestaurantsDetailed(
        customerId,

        skip,

        query.limit,
      );

    return {
      items: items.map((restaurant) => toRestaurantSummary(restaurant)),

      total,

      page: query.page,

      limit: query.limit,

      totalPages: Math.ceil(total / query.limit),
    };
  }

  async getFavoriteMenuItems(
    customerId: string,

    query: GetFavoritesQueryDto,
  ): Promise<PaginatedFavoriteMenuItemsResponseDto> {
    const skip = (query.page - 1) * query.limit;

    const { items, total } =
      await this.favoritesRepository.findFavoriteMenuItemsDetailed(
        customerId,

        skip,

        query.limit,
      );

    return {
      items: items.map((item) => toFavoriteMenuItemResponse(item)),

      total,

      page: query.page,

      limit: query.limit,

      totalPages: Math.ceil(total / query.limit),
    };
  }

  async getRestaurantFavoriteStatus(
    customerId: string,

    rawIds: string,
  ): Promise<FavoriteStatusItemDto[]> {
    const ids = parseIds(rawIds);

    const favorited = await this.favoritesRepository.getFavoritedRestaurantIds(
      customerId,

      ids,
    );

    return ids.map((id) => ({ id, isFavorited: favorited.has(id) }));
  }

  async getMenuItemFavoriteStatus(
    customerId: string,

    rawIds: string,
  ): Promise<FavoriteStatusItemDto[]> {
    const ids = parseIds(rawIds);

    const favorited = await this.favoritesRepository.getFavoritedMenuItemIds(
      customerId,

      ids,
    );

    return ids.map((id) => ({ id, isFavorited: favorited.has(id) }));
  }
}
