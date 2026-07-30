/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import {
  AuditAction,
  Prisma,
  RestaurantMediaType,
  RestaurantStatus,
} from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import { getPagination } from '../../../infrastructure/database/utils/pagination.util';

import { CreateRestaurantDto } from '../dto/create-restaurant.dto';
import { UpdateRestaurantDto } from '../dto/update-restaurant.dto';

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
import { buildActiveOfferWhere } from '../../offers/utils/offer-active-where.util';

import { AuditService } from '../../audit/services/audit.service';
import { EventBusService } from '../../../core/events/event-bus.service';
import {
  AuthenticatedUser,
  canAccessRestaurant,
  hasRestaurantRole,
} from '../../../shared/authorization/order-access.util';

export const RESTAURANT_SUMMARY_INCLUDE = {
  cuisines: { include: { cuisine: true } },
  branches: { include: { operatingHours: true } },
} as const;

/** Picks the branch flagged `isPrimary`, falling back to the first branch for restaurants
 *  created before ERPH-1 introduced the flag (or that never got one set). */
function selectPrimaryBranch(branches: any[] | undefined | null) {
  if (!branches || branches.length === 0) {
    return undefined;
  }

  return branches.find((branch) => branch.isPrimary) ?? branches[0];
}

/**
 * Maps a Restaurant row (loaded with RESTAURANT_SUMMARY_INCLUDE) into the shared discovery
 * payload. "City" and "open now" are derived from the restaurant's primary branch.
 */
export function toRestaurantSummary(
  restaurant: any,
  origin?: { latitude: number; longitude: number },
): RestaurantSummaryDto {
  const primaryBranch = selectPrimaryBranch(restaurant.branches);
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
    isOpenNow: computeIsOpenNow(operatingHours, primaryBranch?.timezone),
    featured: restaurant.featured,
    hasVegOptions: restaurant.hasVegOptions,
    hasVeganOptions: restaurant.hasVeganOptions,
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

    private readonly auditService: AuditService,

    private readonly eventBus: EventBusService,
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

    const restaurant = await this.restaurantsRepository.createRestaurant({
      ownerId,

      name: dto.name,

      slug: dto.slug,

      description: dto.description,

      phone: dto.phone,

      email: dto.email,
    });

    await this.auditService.log(
      ownerId,
      'Restaurant',
      restaurant.id,
      AuditAction.CREATE,
      null,
      { name: restaurant.name, slug: restaurant.slug },
    );

    await this.eventBus.publish('restaurant.created', {
      restaurantId: restaurant.id,
      ownerId,
      name: restaurant.name,
      slug: restaurant.slug,
    });

    return restaurant;
  }

  /**
   * Owner, active co-owner staff, or admin only. Previously there was no update path for a
   * restaurant's profile at all beyond the two dedicated logo/banner upload endpoints.
   */
  async updateRestaurant(
    restaurantId: string,

    dto: UpdateRestaurantDto,

    user: AuthenticatedUser,
  ) {
    const restaurant =
      await this.restaurantsRepository.findRestaurantById(restaurantId);

    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }

    const allowed = await hasRestaurantRole(this.prisma, restaurantId, user, [
      'OWNER',
      'CO_OWNER',
      'ADMIN',
    ]);

    if (!allowed) {
      throw new ForbiddenException(
        'You do not have permission to update this restaurant',
      );
    }

    const updated = await this.restaurantsRepository.updateProfile(
      restaurantId,
      dto,
    );

    await this.auditService.log(
      user.userId,
      'Restaurant',
      restaurantId,
      AuditAction.UPDATE,
      null,
      dto,
    );

    await this.eventBus.publish('restaurant.updated', {
      restaurantId,
      updatedFields: Object.keys(dto),
    });

    return updated;
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

  async uploadLogo(
    restaurantId: string,
    file: UploadFile,
    user: AuthenticatedUser,
  ) {
    const restaurant =
      await this.restaurantsRepository.findRestaurantById(restaurantId);

    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }

    if (!(await canAccessRestaurant(this.prisma, restaurantId, user))) {
      throw new ForbiddenException(
        'You do not have permission to modify this restaurant',
      );
    }

    const logoUrl = await this.storageService.upload(file, 'restaurants/logos');

    await this.mirrorPrimaryMedia(
      restaurantId,
      RestaurantMediaType.LOGO,
      logoUrl,
      user.userId,
    );

    return this.restaurantsRepository.updateImages(restaurantId, { logoUrl });
  }

  async uploadBanner(
    restaurantId: string,
    file: UploadFile,
    user: AuthenticatedUser,
  ) {
    const restaurant =
      await this.restaurantsRepository.findRestaurantById(restaurantId);

    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }

    if (!(await canAccessRestaurant(this.prisma, restaurantId, user))) {
      throw new ForbiddenException(
        'You do not have permission to modify this restaurant',
      );
    }

    const bannerUrl = await this.storageService.upload(
      file,
      'restaurants/banners',
    );

    await this.mirrorPrimaryMedia(
      restaurantId,
      RestaurantMediaType.BANNER,
      bannerUrl,
      user.userId,
    );

    return this.restaurantsRepository.updateImages(restaurantId, { bannerUrl });
  }

  /**
   * Keeps `Restaurant.logoUrl`/`bannerUrl` (the fast-path columns every existing consumer
   * already reads) as the single system of record while also giving logo/banner a row in the
   * new RestaurantMedia gallery table, so "all restaurant media" has one place to query instead
   * of two parallel systems. At most one LOGO and one BANNER row exist per restaurant.
   */
  private async mirrorPrimaryMedia(
    restaurantId: string,
    type: typeof RestaurantMediaType.LOGO | typeof RestaurantMediaType.BANNER,
    url: string,
    uploadedById: string,
  ) {
    await this.prisma.restaurantMedia.deleteMany({
      where: { restaurantId, type },
    });

    await this.prisma.restaurantMedia.create({
      data: { restaurantId, type, url, uploadedById },
    });
  }

  /**
   * Public, customer-facing restaurant listing. `openNow` and `distance` (sort or filter)
   * cannot be expressed as a Prisma `where`/`orderBy` — `openNow` depends on OperatingHour rows
   * evaluated against the current time, and distance is computed from lat/lng in application
   * code — so whenever either is requested this fetches a bounded candidate set, filters/sorts
   * in memory, and paginates the resulting array. Without them, pagination stays fully DB-side
   * as before — no behavior change for the common case.
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
      veg,
      vegan,
      offers,
      minRating,
      maxDeliveryTimeMinutes,
      maxDistanceKm,
      latitude,
      longitude,
      sortBy,
      sortOrder,
    } = query;

    const needsDistance = sortBy === 'distance' || maxDistanceKm !== undefined;

    if (needsDistance && (latitude === undefined || longitude === undefined)) {
      throw new BadRequestException(
        'latitude and longitude are required when sorting or filtering by distance',
      );
    }

    const where: Prisma.RestaurantWhereInput = {
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

    if (veg === 'true') {
      where.hasVegOptions = true;
    }

    if (vegan === 'true') {
      where.hasVeganOptions = true;
    }

    if (offers === 'true') {
      where.offers = { some: buildActiveOfferWhere() };
    }

    if (minRating !== undefined) {
      where.avgRating = { gte: minRating };
    }

    if (maxDeliveryTimeMinutes !== undefined) {
      where.avgDeliveryTimeMinutes = { lte: maxDeliveryTimeMinutes };
    }

    const SORT_COLUMN_MAP: Record<string, string> = {
      rating: 'avgRating',
      popularity: 'deliveredOrderCount',
      deliveryTime: 'avgDeliveryTimeMinutes',
      preparationTime: 'avgPreparationTimeMinutes',
    };

    const sortColumn = SORT_COLUMN_MAP[sortBy] ?? sortBy;
    const orderBy =
      sortBy === 'distance'
        ? { createdAt: 'desc' as const }
        : { [sortColumn]: sortOrder };

    if (openNow === 'true' || needsDistance) {
      const CANDIDATE_LIMIT = 500;

      let candidates = await this.prisma.restaurant.findMany({
        where,
        take: CANDIDATE_LIMIT,
        orderBy,
        include: RESTAURANT_SUMMARY_INCLUDE,
      });

      if (openNow === 'true') {
        candidates = candidates.filter((restaurant) => {
          const primaryBranch = selectPrimaryBranch(restaurant.branches);

          return computeIsOpenNow(
            primaryBranch?.operatingHours ?? [],
            primaryBranch?.timezone,
          );
        });
      }

      const origin =
        needsDistance && latitude !== undefined && longitude !== undefined
          ? { latitude, longitude }
          : undefined;

      let summaries = candidates.map((restaurant) =>
        toRestaurantSummary(restaurant, origin),
      );

      if (maxDistanceKm !== undefined) {
        summaries = summaries.filter(
          (summary) =>
            summary.distanceKm !== undefined &&
            summary.distanceKm <= maxDistanceKm,
        );
      }

      if (sortBy === 'distance') {
        summaries = summaries.sort(
          (a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity),
        );

        if (sortOrder === 'desc') {
          summaries = summaries.reverse();
        }
      }

      const { skip, take } = getPagination(page, limit);
      const pageItems = summaries.slice(skip, skip + take);

      return {
        items: pageItems,
        total: summaries.length,
        page,
        limit,
        totalPages: Math.ceil(summaries.length / limit),
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

  /**
   * adminUserId is nullable specifically so OnboardingVerificationDecisionListener can trigger
   * this as a system-initiated transition (once verification reaches APPROVED) without a human
   * admin acting — AuditLog.userId is itself nullable for exactly this "system action" case, so
   * this passes null through rather than fabricating a fake user id that would violate the
   * AuditLog -> User foreign key.
   */
  async approveRestaurant(restaurantId: string, adminUserId: string | null) {
    return this.transitionStatus(
      restaurantId,
      RestaurantStatus.PENDING,
      RestaurantStatus.APPROVED,
      adminUserId,
      AuditAction.APPROVE,
    );
  }

  async rejectRestaurant(restaurantId: string, adminUserId: string) {
    return this.transitionStatus(
      restaurantId,
      RestaurantStatus.PENDING,
      RestaurantStatus.REJECTED,
      adminUserId,
      AuditAction.REJECT,
    );
  }

  async suspendRestaurant(restaurantId: string, adminUserId: string) {
    return this.transitionStatus(
      restaurantId,
      RestaurantStatus.APPROVED,
      RestaurantStatus.SUSPENDED,
      adminUserId,
      AuditAction.STATUS_CHANGE,
    );
  }

  async restoreRestaurant(restaurantId: string, adminUserId: string) {
    return this.transitionStatus(
      restaurantId,
      RestaurantStatus.SUSPENDED,
      RestaurantStatus.APPROVED,
      adminUserId,
      AuditAction.STATUS_CHANGE,
    );
  }

  /**
   * Sprint 1.9. The pre-check (find + JS status comparison) stays as a fast, friendly
   * pre-validation — it's what turns a doomed request into a clean 404/400 without ever reaching
   * the DB write — but it is NOT what makes this method exactly-once: that guarantee comes solely
   * from claimStatusTransition's conditional updateMany below. A stale read here (the restaurant
   * concurrently changed status between this read and the claim) simply means the claim itself
   * fails with count 0, correctly reported as a 409 Conflict rather than silently overwriting
   * whatever the winning concurrent request just committed.
   */
  private async transitionStatus(
    restaurantId: string,

    requiredStatus: RestaurantStatus,

    nextStatus: RestaurantStatus,

    adminUserId: string | null,

    auditAction: AuditAction,
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

    const claim = await this.restaurantsRepository.claimStatusTransition(
      restaurantId,

      [requiredStatus],

      nextStatus,
    );

    if (claim.count === 0) {
      throw new ConflictException(
        `This restaurant is no longer in status ${requiredStatus} — a concurrent admin action already changed it`,
      );
    }

    // Audit is written only now, after the claim actually succeeded — a losing concurrent
    // request never reaches this line, so the audit trail can never disagree with the final
    // database state (the confirmed "audit history can disagree with final DB state" finding).
    await this.auditService.log(
      adminUserId,
      'Restaurant',
      restaurantId,
      auditAction,
      { status: requiredStatus },
      { status: nextStatus },
    );

    if (nextStatus === RestaurantStatus.APPROVED) {
      await this.eventBus.publish('restaurant.activated', { restaurantId });
    }

    return this.restaurantsRepository.findRestaurantById(restaurantId);
  }
}
