import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { FavoritesService } from '../services/favorites.service';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

import { GetFavoritesQueryDto } from '../dto/get-favorites-query.dto';
import { FavoriteStatusQueryDto } from '../dto/favorite-status-query.dto';
import { FavoriteStatusItemDto } from '../dto/favorite-status-item.dto';
import { FavoriteToggleResponseDto } from '../dto/favorite-toggle-response.dto';
import { PaginatedFavoriteMenuItemsResponseDto } from '../dto/paginated-favorite-menu-items-response.dto';

import { PaginatedRestaurantSummariesResponseDto } from '../../restaurants/dto/paginated-restaurant-summaries-response.dto';

@ApiTags('Favorites')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('favorites')
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @ApiOperation({ summary: "List the current customer's favorite restaurants" })
  @ApiOkResponse({
    description: 'Favorite restaurants retrieved successfully',
    type: PaginatedRestaurantSummariesResponseDto,
  })
  @Get('restaurants')
  getFavoriteRestaurants(
    @CurrentUser() user: any,

    @Query() query: GetFavoritesQueryDto,
  ) {
    return this.favoritesService.getFavoriteRestaurants(user.userId, query);
  }

  @ApiOperation({
    summary: 'Bulk-check favorite status for a set of restaurant ids',
    description:
      'Accepts a comma-separated list of restaurant ids and returns their favorite status in a single request, so restaurant cards on a listing page never issue one favorite-status request each.',
  })
  @ApiQuery({ name: 'ids', description: 'Comma-separated restaurant ids' })
  @ApiOkResponse({
    description: 'Favorite status retrieved successfully',
    type: [FavoriteStatusItemDto],
  })
  @Get('restaurants/status')
  getRestaurantFavoriteStatus(
    @CurrentUser() user: any,

    @Query() query: FavoriteStatusQueryDto,
  ) {
    return this.favoritesService.getRestaurantFavoriteStatus(
      user.userId,

      query.ids,
    );
  }

  @ApiOperation({ summary: 'Add a restaurant to favorites' })
  @ApiParam({ name: 'restaurantId' })
  @ApiOkResponse({
    description: 'Restaurant favorited successfully',
    type: FavoriteToggleResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Restaurant not found' })
  @Post('restaurants/:restaurantId')
  addRestaurantFavorite(
    @CurrentUser() user: any,

    @Param('restaurantId') restaurantId: string,
  ) {
    return this.favoritesService.addRestaurantFavorite(
      user.userId,

      restaurantId,
    );
  }

  @ApiOperation({ summary: 'Remove a restaurant from favorites' })
  @ApiParam({ name: 'restaurantId' })
  @ApiOkResponse({
    description: 'Restaurant unfavorited successfully',
    type: FavoriteToggleResponseDto,
  })
  @Delete('restaurants/:restaurantId')
  removeRestaurantFavorite(
    @CurrentUser() user: any,

    @Param('restaurantId') restaurantId: string,
  ) {
    return this.favoritesService.removeRestaurantFavorite(
      user.userId,

      restaurantId,
    );
  }

  @ApiOperation({ summary: "List the current customer's favorite menu items" })
  @ApiOkResponse({
    description: 'Favorite menu items retrieved successfully',
    type: PaginatedFavoriteMenuItemsResponseDto,
  })
  @Get('menu-items')
  getFavoriteMenuItems(
    @CurrentUser() user: any,

    @Query() query: GetFavoritesQueryDto,
  ) {
    return this.favoritesService.getFavoriteMenuItems(user.userId, query);
  }

  @ApiOperation({
    summary: 'Bulk-check favorite status for a set of menu item ids',
    description:
      'Accepts a comma-separated list of menu item ids and returns their favorite status in a single request, so menu item cards never issue one favorite-status request each.',
  })
  @ApiQuery({ name: 'ids', description: 'Comma-separated menu item ids' })
  @ApiOkResponse({
    description: 'Favorite status retrieved successfully',
    type: [FavoriteStatusItemDto],
  })
  @Get('menu-items/status')
  getMenuItemFavoriteStatus(
    @CurrentUser() user: any,

    @Query() query: FavoriteStatusQueryDto,
  ) {
    return this.favoritesService.getMenuItemFavoriteStatus(
      user.userId,

      query.ids,
    );
  }

  @ApiOperation({ summary: 'Add a menu item to favorites' })
  @ApiParam({ name: 'menuItemId' })
  @ApiOkResponse({
    description: 'Menu item favorited successfully',
    type: FavoriteToggleResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Menu item not found' })
  @Post('menu-items/:menuItemId')
  addMenuItemFavorite(
    @CurrentUser() user: any,

    @Param('menuItemId') menuItemId: string,
  ) {
    return this.favoritesService.addMenuItemFavorite(
      user.userId,

      menuItemId,
    );
  }

  @ApiOperation({ summary: 'Remove a menu item from favorites' })
  @ApiParam({ name: 'menuItemId' })
  @ApiOkResponse({
    description: 'Menu item unfavorited successfully',
    type: FavoriteToggleResponseDto,
  })
  @Delete('menu-items/:menuItemId')
  removeMenuItemFavorite(
    @CurrentUser() user: any,

    @Param('menuItemId') menuItemId: string,
  ) {
    return this.favoritesService.removeMenuItemFavorite(
      user.userId,

      menuItemId,
    );
  }
}
