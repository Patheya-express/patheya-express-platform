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

import { CreateRestaurantDto } from '../dto/create-restaurant.dto';

import { RestaurantsRepository } from '../repositories/restaurants.repository';

import { GetRestaurantsQueryDto } from '../dto/get-restaurants-query.dto';
import { GetAdminRestaurantsQueryDto } from '../dto/get-admin-restaurants-query.dto';
import { PaginatedRestaurantsResponseDto } from '../dto/paginated-restaurants-response.dto';

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

@Injectable()
export class RestaurantsService {
  constructor(
    private readonly prisma: PrismaService,

    private readonly restaurantsRepository: RestaurantsRepository,
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

    return restaurant;
  }
  async findAll(query: GetRestaurantsQueryDto) {
    const { page, limit, search, sortBy, sortOrder } = query;

    const where: any = {
      status: 'APPROVED',
      isActive: true,
    };

    if (search) {
      where.OR = [
        {
          name: {
            contains: search,
            mode: 'insensitive',
          },
        },
        {
          description: {
            contains: search,
            mode: 'insensitive',
          },
        },
      ];
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.restaurant.findMany({
        where,

        skip: (page - 1) * limit,

        take: limit,

        orderBy: {
          [sortBy]: sortOrder,
        },

        include: {
          cuisines: true,
          branches: true,
        },
      }),

      this.prisma.restaurant.count({
        where,
      }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async countByStatus(status?: RestaurantStatus): Promise<number> {
    return this.restaurantsRepository.countByStatus(status);
  }

  async getAllForAdmin(query: GetAdminRestaurantsQueryDto): Promise<PaginatedRestaurantsResponseDto> {
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
    return this.transitionStatus(restaurantId, RestaurantStatus.PENDING, RestaurantStatus.APPROVED);
  }

  async rejectRestaurant(restaurantId: string) {
    return this.transitionStatus(restaurantId, RestaurantStatus.PENDING, RestaurantStatus.REJECTED);
  }

  async suspendRestaurant(restaurantId: string) {
    return this.transitionStatus(restaurantId, RestaurantStatus.APPROVED, RestaurantStatus.SUSPENDED);
  }

  async restoreRestaurant(restaurantId: string) {
    return this.transitionStatus(restaurantId, RestaurantStatus.SUSPENDED, RestaurantStatus.APPROVED);
  }

  private async transitionStatus(
    restaurantId: string,

    requiredStatus: RestaurantStatus,

    nextStatus: RestaurantStatus,
  ) {
    const restaurant = await this.restaurantsRepository.findRestaurantById(restaurantId);

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
