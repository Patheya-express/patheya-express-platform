/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  BadRequestException,
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import { RestaurantStatus } from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import { getPagination } from '../../../infrastructure/database/utils/pagination.util';

import { CreateRestaurantDto } from '../dto/create-restaurant.dto';

import { RestaurantsRepository } from '../repositories/restaurants.repository';

import { GetRestaurantsQueryDto } from '../dto/get-restaurants-query.dto';
import { GetAdminRestaurantsQueryDto } from '../dto/get-admin-restaurants-query.dto';
import { PaginatedRestaurantsResponseDto } from '../dto/paginated-restaurants-response.dto';
import { RestaurantSummaryDto } from '../dto/restaurant-summary.dto';
import { PaginatedRestaurantSummariesResponseDto } from '../dto/paginated-restaurant-summaries-response.dto';

import { computeIsOpenNow } from '../utils/operating-hours.util';
import { haversineDistanceKm } from '../utils/geo.util';

import { StorageService } from '../../storage/services/storage.service';
import { UploadFile } from '../../../shared/types/upload-file.type';

import { OffersService } from '../../offers/services/offers.service';
import { OfferResponseDto } from '../../offers/dto/offer-response.dto';

export const RESTAURANT_SUMMARY_INCLUDE = {
  cuisines: { include: { cuisine: true } },
  branches: { include: { operatingHours: true } },
} as const;

/**
 * Maps a Restaurant row (loaded with RESTAURANT_SUMMARY_INCLUDE) into the shared discovery
 * payload. "City" and "open now" are derived from the first branch — restaurants in this
 * platform are currently single-branch in practice, and there's no "primary branch" flag to
 * pick a specific one if there were several.
 */
export function toRestaurantSummary(
  restaurant: any,
  origin?: { latitude: number; longitude: number },
): RestaurantSummaryDto {
  const primaryBranch = restaurant.branches?.[0];
  const operatingHours = primaryBranch?.operatingHours ?? [];

  let distanceKm: number | undefined;

  if (
    origin &&
    primaryBranch?.latitude != null &&
    primaryBranch?.longitude != null
  ) {
    distanceKm = haversineDistanceKm(
      origin.latitude,
      origin.longitude,
      primaryBranch.latitude,
      primaryBranch.longitude,
    );
  }

  return {
    id: restaurant.id,
    name: restaurant.name,
    slug: restaurant.slug,
    logoUrl: restaurant.logoUrl ?? undefined,
    bannerUrl: restaurant.bannerUrl ?? undefined,
    cuisines: (restaurant.cuisines ?? []).map(
      (entry: any) => entry.cuisine.name,
    ),
    city: primaryBranch?.city,
    avgRating: restaurant.avgRating,
    ratingCount: restaurant.ratingCount,
    avgPreparationTimeMinutes:
      restaurant.avgPreparationTimeMinutes ?? undefined,
    avgDeliveryTimeMinutes: restaurant.avgDeliveryTimeMinutes ?? undefined,
    isOpenNow: computeIsOpenNow(operatingHours),
    featured: restaurant.featured,
    distanceKm,
  };
}

/**
 * Flattens the raw Prisma include shape (owner as a full User row, cuisines as
 * RestaurantCuisine join rows, branches already narrowed by `select`) into the documented
 * RestaurantResponseDto shape — critically, this is what keeps the owner's passwordHash and
 * every other auth-related field out of admin API responses.
 */
function toSafeRestaurant(restaurant: any) {
  const { owner, cuisines, branches, ...rest } = restaurant;

  return {
    ...rest,

    owner: owner
      ? {
          id: owner.id,
          firstName: owner.firstName,
          lastName: owner.lastName,
          email: owner.email,
          phone: owner.phone,
        }
      : undefined,

    cuisines: cuisines?.map((entry: any) => ({ name: entry.cuisine.name })),

    branches,
  };
}

/**
 * Flattens the raw Prisma include shape (cuisines/branches as join/nested rows) produced by
 * RestaurantsRepository.findRestaurantById into the documented RestaurantResponseDto shape for
 * the public restaurant detail endpoint. Offers are fetched separately via OffersService (the
 * single source of truth for "is this offer still active/valid right now"), not read off the
 * Restaurant row.
 */
function toRestaurantDetail(restaurant: any, offers: OfferResponseDto[]) {
  const { owner, cuisines, branches, ...rest } = restaurant;

  return {
    ...rest,

    owner: owner
      ? {
          id: owner.id,
          firstName: owner.firstName,
          lastName: owner.lastName,
          email: owner.email,
          phone: owner.phone,
        }
      : undefined,

    cuisines: cuisines?.map((entry: any) => ({ name: entry.cuisine.name })),

    branches: branches?.map((branch: any) => ({
      id: branch.id,
      name: branch.name,
      addressLine1: branch.addressLine1,
      addressLine2: branch.addressLine2 ?? undefined,
      city: branch.city,
      state: branch.state,
      postalCode: branch.postalCode,
      latitude: branch.latitude ?? undefined,
      longitude: branch.longitude ?? undefined,
      phone: branch.phone ?? undefined,
      operatingHours: (branch.operatingHours ?? []).map((hour: any) => ({
        id: hour.id,
        dayOfWeek: hour.dayOfWeek,
        opensAt: hour.opensAt,
        closesAt: hour.closesAt,
        isClosed: hour.isClosed,
      })),
    })),

    offers,
  };
}

@Injectable()
export class RestaurantsService {
  constructor(
    private readonly prisma: PrismaService,

    private readonly restaurantsRepository: RestaurantsRepository,

    private readonly storageService: StorageService,

    private readonly offersService: OffersService,
  ) {}

  async createRestaurant(
    ownerId: string,

    dto: CreateRestaurantDto,
  ) {
    const existingRestaurant = await this.prisma.restaurant.findUnique({
      where: {
        slug: dto.slug,
      },
    });

    if (existingRestaurant) {
      throw new ConflictException('Restaurant slug already exists');
    }

    return this.restaurantsRepository.createRestaurant({
      ownerId,

      name: dto.name,

      slug: dto.slug,

      description: dto.description,

      phone: dto.phone,

      email: dto.email,
    });
  }

  async getMyRestaurants(ownerId: string) {
    return this.restaurantsRepository.findRestaurantsByOwner(ownerId);
  }

  async getRestaurantById(restaurantId: string) {
    const restaurant =
      await this.restaurantsRepository.findRestaurantById(restaurantId);

    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }

    const offers =
      await this.offersService.findActiveForRestaurant(restaurantId);

    return toRestaurantDetail(restaurant, offers);
  }

  /** Called by OrdersService when an order reaches DELIVERED through the normal fulfillment flow. */
  async recordOrderTiming(
    restaurantId: string,
    prepMinutes: number | null,
    deliveryMinutes: number,
  ) {
    return this.restaurantsRepository.recordOrderTiming(
      restaurantId,
      prepMinutes,
      deliveryMinutes,
    );
  }

  async uploadLogo(restaurantId: string, file: UploadFile) {
    const restaurant =
      await this.restaurantsRepository.findRestaurantById(restaurantId);

    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }

    const logoUrl = await this.storageService.upload(file, 'restaurants/logos');

    return this.restaurantsRepository.updateImages(restaurantId, { logoUrl });
  }

  async uploadBanner(restaurantId: string, file: UploadFile) {
    const restaurant =
      await this.restaurantsRepository.findRestaurantById(restaurantId);

    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }

    const bannerUrl = await this.storageService.upload(
      file,
      'restaurants/banners',
    );

    return this.restaurantsRepository.updateImages(restaurantId, { bannerUrl });
  }

  /**
   * Public, customer-facing restaurant listing. `openNow` cannot be expressed as a Prisma
   * `where` clause (it depends on OperatingHour rows evaluated against the current time in
   * application code), so when it's requested this fetches a bounded candidate set, filters
   * in memory, and paginates the filtered result. Without `openNow`, pagination stays fully
   * DB-side as before — no behavior change for the common case.
   */
  async findAll(
    query: GetRestaurantsQueryDto,
  ): Promise<PaginatedRestaurantSummariesResponseDto> {
    const {
      page,
      limit,
      search,
      city,
      cuisine,
      featured,
      openNow,
      sortBy,
      sortOrder,
    } = query;

    const where: any = {
      status: 'APPROVED',
      isActive: true,
    };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (city) {
      where.branches = {
        some: { city: { contains: city, mode: 'insensitive' } },
      };
    }

    if (cuisine) {
      where.cuisines = {
        some: { cuisine: { name: { contains: cuisine, mode: 'insensitive' } } },
      };
    }

    if (featured !== undefined) {
      where.featured = featured === 'true';
    }

    const sortColumn = sortBy === 'rating' ? 'avgRating' : sortBy;
    const orderBy = { [sortColumn]: sortOrder };

    if (openNow === 'true') {
      const CANDIDATE_LIMIT = 500;

      const candidates = await this.prisma.restaurant.findMany({
        where,
        take: CANDIDATE_LIMIT,
        orderBy,
        include: RESTAURANT_SUMMARY_INCLUDE,
      });

      const openCandidates = candidates.filter((restaurant) =>
        computeIsOpenNow(restaurant.branches?.[0]?.operatingHours ?? []),
      );

      const { skip, take } = getPagination(page, limit);
      const page_ = openCandidates.slice(skip, skip + take);

      return {
        items: page_.map((restaurant) => toRestaurantSummary(restaurant)),
        total: openCandidates.length,
        page,
        limit,
        totalPages: Math.ceil(openCandidates.length / limit),
      };
    }

    const { skip, take } = getPagination(page, limit);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.restaurant.findMany({
        where,
        skip,
        take,
        orderBy,
        include: RESTAURANT_SUMMARY_INCLUDE,
      }),

      this.prisma.restaurant.count({ where }),
    ]);

    return {
      items: items.map((restaurant) => toRestaurantSummary(restaurant)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async countByStatus(status?: RestaurantStatus): Promise<number> {
    return this.restaurantsRepository.countByStatus(status);
  }

  async findFeatured(limit: number): Promise<RestaurantSummaryDto[]> {
    const restaurants = await this.prisma.restaurant.findMany({
      where: { status: 'APPROVED', isActive: true, featured: true },
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: RESTAURANT_SUMMARY_INCLUDE,
    });

    return restaurants.map((restaurant) => toRestaurantSummary(restaurant));
  }

  /**
   * "Popular" = most ordered-from in the last 30 days. Computed on demand via groupBy rather
   * than a denormalized counter — order volume changes constantly and a rolling window is
   * more useful (and simpler to keep correct) than a lifetime total that never reflects
   * declining demand.
   */
  async findPopular(limit: number): Promise<RestaurantSummaryDto[]> {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const grouped = await this.prisma.order.groupBy({
      by: ['restaurantId'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      orderBy: { _count: { restaurantId: 'desc' } },
      take: limit,
    });

    if (grouped.length === 0) {
      return [];
    }

    const restaurants = await this.prisma.restaurant.findMany({
      where: {
        id: { in: grouped.map((g) => g.restaurantId) },
        status: 'APPROVED',
        isActive: true,
      },
      include: RESTAURANT_SUMMARY_INCLUDE,
    });

    const byId = new Map(restaurants.map((r) => [r.id, r]));

    return grouped
      .map((g) => byId.get(g.restaurantId))
      .filter((r): r is NonNullable<typeof r> => r != null)
      .map((restaurant) => toRestaurantSummary(restaurant));
  }

  /**
   * Nearby restaurants within `radiusKm` of the given point, closest first. Prefilters with a
   * coarse lat/lng bounding box at the database level (cheap, index-friendly), then computes
   * exact haversine distance in application code over that smaller candidate set. Good enough
   * at current scale; a PostGIS distance index would be the next step if the restaurant count
   * grows large enough for the bounding-box candidate set itself to become expensive.
   */
  async findNearby(
    latitude: number,
    longitude: number,
    limit: number,
    radiusKm = 10,
  ): Promise<RestaurantSummaryDto[]> {
    const latDelta = radiusKm / 111;
    const lngDelta = radiusKm / (111 * Math.cos((latitude * Math.PI) / 180));

    const candidates = await this.prisma.restaurant.findMany({
      where: {
        status: 'APPROVED',
        isActive: true,
        branches: {
          some: {
            latitude: { gte: latitude - latDelta, lte: latitude + latDelta },
            longitude: { gte: longitude - lngDelta, lte: longitude + lngDelta },
          },
        },
      },
      include: RESTAURANT_SUMMARY_INCLUDE,
    });

    const origin = { latitude, longitude };

    return candidates
      .map((restaurant) => toRestaurantSummary(restaurant, origin))
      .filter(
        (summary) =>
          summary.distanceKm !== undefined && summary.distanceKm <= radiusKm,
      )
      .sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0))
      .slice(0, limit);
  }

  /**
   * Recommended = nearby AND highly rated (avgRating >= 4 with at least one real review) AND
   * open right now. Deliberately rule-based rather than ML-driven for this phase — an honest,
   * explainable "why am I seeing this" beats a black-box recommendation with no signal to back
   * it yet (the platform has no purchase-history-based personalization data pipeline today).
   */
  async findRecommended(
    latitude: number,
    longitude: number,
    limit: number,
  ): Promise<RestaurantSummaryDto[]> {
    const nearby = await this.findNearby(latitude, longitude, 50, 10);

    return nearby
      .filter((r) => r.avgRating >= 4 && r.ratingCount > 0 && r.isOpenNow)
      .slice(0, limit);
  }

  async getAllForAdmin(
    query: GetAdminRestaurantsQueryDto,
  ): Promise<PaginatedRestaurantsResponseDto> {
    const skip = (query.page - 1) * query.limit;

    const { items, total } = await this.restaurantsRepository.findAllForAdmin({
      skip,

      take: query.limit,

      search: query.search,

      city: query.city,

      cuisine: query.cuisine,

      status: query.status,
    });

    return {
      items: items.map((restaurant) => toSafeRestaurant(restaurant)),

      total,

      page: query.page,

      limit: query.limit,

      totalPages: Math.ceil(total / query.limit),
    };
  }

  async approveRestaurant(restaurantId: string) {
    return this.transitionStatus(
      restaurantId,
      RestaurantStatus.PENDING,
      RestaurantStatus.APPROVED,
    );
  }

  async rejectRestaurant(restaurantId: string) {
    return this.transitionStatus(
      restaurantId,
      RestaurantStatus.PENDING,
      RestaurantStatus.REJECTED,
    );
  }

  async suspendRestaurant(restaurantId: string) {
    return this.transitionStatus(
      restaurantId,
      RestaurantStatus.APPROVED,
      RestaurantStatus.SUSPENDED,
    );
  }

  async restoreRestaurant(restaurantId: string) {
    return this.transitionStatus(
      restaurantId,
      RestaurantStatus.SUSPENDED,
      RestaurantStatus.APPROVED,
    );
  }

  private async transitionStatus(
    restaurantId: string,

    requiredStatus: RestaurantStatus,

    nextStatus: RestaurantStatus,
  ) {
    const restaurant =
      await this.restaurantsRepository.findRestaurantById(restaurantId);

    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }

    if (restaurant.status !== requiredStatus) {
      throw new BadRequestException(
        `Only restaurants with status ${requiredStatus} can transition to ${nextStatus}`,
      );
    }

    return this.restaurantsRepository.updateStatus(restaurantId, nextStatus);
  }
}
