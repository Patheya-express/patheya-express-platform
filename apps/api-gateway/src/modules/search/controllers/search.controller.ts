import {
  Body,
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
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { Throttle } from '@nestjs/throttler';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

import { SearchService } from '../services/search.service';

import { GlobalSearchQueryDto } from '../dto/global-search-query.dto';
import { GetMenuItemSearchQueryDto } from '../dto/get-menu-item-search-query.dto';
import { GlobalSearchResponseDto } from '../dto/global-search-response.dto';
import { PaginatedMenuItemSearchResponseDto } from '../dto/paginated-menu-item-search-response.dto';
import { SearchSuggestionDto } from '../dto/search-suggestion.dto';
import { RecentSearchDto } from '../dto/recent-search.dto';
import { TrendingSearchDto } from '../dto/trending-search.dto';
import { LogSearchDto } from '../dto/log-search.dto';

@ApiTags('Search')
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get('global')
  @ApiOperation({
    summary: 'Global search',
    description:
      'Quick combined preview across restaurants and menu items (cross-restaurant) for a search bar. Not deeply paginated — use GET /restaurants?search= or GET /search/menu-items for the full paginated view of each.',
  })
  @ApiQuery({ name: 'q', required: true })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiOkResponse({ type: GlobalSearchResponseDto })
  globalSearch(
    @Query()
    query: GlobalSearchQueryDto,
  ) {
    return this.searchService.globalSearch(query.q, query.limit);
  }

  @Get('menu-items')
  @ApiOperation({
    summary: 'Cross-restaurant menu item search',
    description:
      'Paginated search for dishes across every approved, active restaurant.',
  })
  @ApiQuery({ name: 'q', required: true })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiOkResponse({ type: PaginatedMenuItemSearchResponseDto })
  searchMenuItems(
    @Query()
    query: GetMenuItemSearchQueryDto,
  ) {
    return this.searchService.searchMenuItems(query.q, query.page, query.limit);
  }

  @Get('suggestions')
  @ApiOperation({
    summary: 'Live search suggestions',
    description:
      'Small, fast, mixed set of restaurant/cuisine/menu-item name matches for autocomplete-as-you-type.',
  })
  @ApiQuery({ name: 'q', required: true })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiOkResponse({ type: SearchSuggestionDto, isArray: true })
  getSuggestions(
    @Query()
    query: GlobalSearchQueryDto,
  ) {
    return this.searchService.getSuggestions(query.q, query.limit);
  }

  @Get('trending')
  @ApiOperation({
    summary: 'Trending searches',
    description:
      'Precomputed by a scheduled BullMQ aggregation job over recent search volume — never aggregated on the request path.',
  })
  @ApiOkResponse({ type: TrendingSearchDto, isArray: true })
  getTrending() {
    return this.searchService.getTrendingSearches();
  }

  @Post('log')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({
    summary: 'Log a committed search',
    description:
      'Public — records the query for trending-search aggregation. Call this whenever a user commits a search (e.g. presses enter / opens results), not on every keystroke.',
  })
  logSearch(
    @Body()
    dto: LogSearchDto,
  ) {
    return this.searchService.logSearch(dto.query);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @Post('recent')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({
    summary: 'Record a recent search for the authenticated customer',
  })
  recordRecent(
    @CurrentUser()
    user: any,

    @Body()
    dto: LogSearchDto,
  ) {
    return this.searchService.recordRecentSearch(user.userId, dto.query);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @Get('recent')
  @ApiOperation({
    summary: "Get the authenticated customer's recent searches",
  })
  @ApiOkResponse({ type: RecentSearchDto, isArray: true })
  getRecent(
    @CurrentUser()
    user: any,
  ) {
    return this.searchService.getRecentSearches(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @Delete('recent/:id')
  @ApiOperation({ summary: 'Delete a single recent search entry' })
  @ApiParam({ name: 'id' })
  deleteRecent(
    @CurrentUser()
    user: any,

    @Param('id')
    id: string,
  ) {
    return this.searchService.deleteRecentSearch(id, user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @Delete('recent')
  @ApiOperation({
    summary: 'Clear all recent searches for the authenticated customer',
  })
  clearRecent(
    @CurrentUser()
    user: any,
  ) {
    return this.searchService.clearRecentSearches(user.userId);
  }
}
