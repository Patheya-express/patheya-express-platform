import { Injectable } from '@nestjs/common';

import { Prisma } from '@prisma/client';

import { RestaurantsService } from '../../restaurants/services/restaurants.service';
import { CuisinesService } from '../../restaurants/services/cuisines.service';
import { MenuService } from '../../menu/services/menu.service';
import { SearchRepository } from '../repositories/search.repository';

import { MENU_ITEM_SEARCH_INCLUDE } from '../../menu/repositories/menu.repository';

import { GlobalSearchResponseDto } from '../dto/global-search-response.dto';
import { PaginatedMenuItemSearchResponseDto } from '../dto/paginated-menu-item-search-response.dto';
import { MenuItemSearchResultDto } from '../dto/menu-item-search-result.dto';
import { SearchSuggestionDto } from '../dto/search-suggestion.dto';
import { RecentSearchDto } from '../dto/recent-search.dto';
import { TrendingSearchDto } from '../dto/trending-search.dto';

const TRENDING_LIMIT = 10;
const SUGGESTION_RESTAURANT_SHARE = 4;
const SUGGESTION_CUISINE_SHARE = 2;

type MenuItemSearchRow = Prisma.MenuItemGetPayload<{
  include: typeof MENU_ITEM_SEARCH_INCLUDE;
}>;

function toMenuItemSearchResult(
  item: MenuItemSearchRow,
): MenuItemSearchResultDto {
  return {
    id: item.id,
    name: item.name,
    description: item.description ?? undefined,
    imageUrl: item.imageUrl ?? undefined,
    basePrice: Number(item.basePrice),
    isVegetarian: item.isVegetarian,
    isVegan: item.isVegan,
    restaurantId: item.category.restaurant.id,
    restaurantName: item.category.restaurant.name,
    restaurantSlug: item.category.restaurant.slug,
  };
}

@Injectable()
export class SearchService {
  constructor(
    private readonly restaurantsService: RestaurantsService,
    private readonly cuisinesService: CuisinesService,
    private readonly menuService: MenuService,
    private readonly searchRepository: SearchRepository,
  ) {}

  /** Quick, non-deep-paginated combined preview — powers a search bar's live results panel. */
  async globalSearch(
    q: string,
    limit: number,
  ): Promise<GlobalSearchResponseDto> {
    const [restaurantResult, menuItemResult] = await Promise.all([
      this.restaurantsService.findAll({
        page: 1,
        limit,
        search: q,
        sortBy: 'name',
        sortOrder: 'asc',
      }),

      this.menuService.searchMenuItemsAcrossRestaurants({
        search: q,
        skip: 0,
        take: limit,
      }),
    ]);

    return {
      restaurants: restaurantResult.items,
      menuItems: menuItemResult.items.map(toMenuItemSearchResult),
    };
  }

  /** Full paginated cross-restaurant menu item search — the deep-dive view behind "see all dish results". */
  async searchMenuItems(
    q: string,
    page: number,
    limit: number,
  ): Promise<PaginatedMenuItemSearchResponseDto> {
    const skip = (page - 1) * limit;

    const { items, total } =
      await this.menuService.searchMenuItemsAcrossRestaurants({
        search: q,
        skip,
        take: limit,
      });

    return {
      items: items.map(toMenuItemSearchResult),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getSuggestions(
    q: string,
    limit: number,
  ): Promise<SearchSuggestionDto[]> {
    const restaurantLimit = Math.min(SUGGESTION_RESTAURANT_SHARE, limit);
    const cuisineLimit = Math.min(SUGGESTION_CUISINE_SHARE, limit);
    const menuItemLimit = Math.max(limit - restaurantLimit - cuisineLimit, 0);

    const [restaurantResult, cuisines, menuItems] = await Promise.all([
      this.restaurantsService.findAll({
        page: 1,
        limit: restaurantLimit,
        search: q,
        sortBy: 'name',
        sortOrder: 'asc',
      }),

      this.cuisinesService.findAll(q),

      this.menuService.findMenuItemNameMatches(q, menuItemLimit),
    ]);

    const suggestions: SearchSuggestionDto[] = [
      ...restaurantResult.items.map((restaurant) => ({
        type: 'RESTAURANT' as const,
        id: restaurant.id,
        label: restaurant.name,
      })),
      ...cuisines.slice(0, cuisineLimit).map((cuisine) => ({
        type: 'CUISINE' as const,
        id: cuisine.id,
        label: cuisine.name,
      })),
      ...menuItems.map((item) => ({
        type: 'MENU_ITEM' as const,
        id: item.id,
        label: item.name,
        restaurantId: item.category.restaurant.id,
      })),
    ];

    return suggestions.slice(0, limit);
  }

  async logSearch(query: string, customerId?: string): Promise<void> {
    await this.searchRepository.createSearchLog(query.trim(), customerId);
  }

  async recordRecentSearch(customerId: string, query: string): Promise<void> {
    await this.searchRepository.upsertRecentSearch(customerId, query.trim());
  }

  async getRecentSearches(customerId: string): Promise<RecentSearchDto[]> {
    const rows = await this.searchRepository.findRecentSearches(customerId);

    return rows.map((row) => ({
      id: row.id,
      query: row.query,
      updatedAt: row.updatedAt,
    }));
  }

  async deleteRecentSearch(id: string, customerId: string): Promise<void> {
    await this.searchRepository.deleteRecentSearch(id, customerId);
  }

  async clearRecentSearches(customerId: string): Promise<void> {
    await this.searchRepository.clearRecentSearches(customerId);
  }

  async getTrendingSearches(): Promise<TrendingSearchDto[]> {
    const rows =
      await this.searchRepository.findTrendingSearches(TRENDING_LIMIT);

    return rows.map((row) => ({ query: row.query, score: row.score }));
  }
}
