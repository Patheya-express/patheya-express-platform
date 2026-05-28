import {
    Injectable,
    ConflictException,
    NotFoundException,
  } from '@nestjs/common';
  
  import { PrismaService }
  from '../../../infrastructure/database/prisma.service';
  
  import { CreateRestaurantDto }
  from '../dto/create-restaurant.dto';
  
  import { RestaurantsRepository }
  from '../repositories/restaurants.repository';
  
  @Injectable()
  export class RestaurantsService {
  
    constructor(
  
      private readonly prisma:
        PrismaService,
  
      private readonly restaurantsRepository:
        RestaurantsRepository,
  
    ) {}
  
    async createRestaurant(
  
      ownerId: string,
  
      dto: CreateRestaurantDto,
  
    ) {
  
      const existingRestaurant =
  
        await this.prisma.restaurant
          .findUnique({
  
            where: {
              slug: dto.slug,
            },
  
          });
  
      if (existingRestaurant) {
  
        throw new ConflictException(
          'Restaurant slug already exists',
        );
  
      }
  
      return this.restaurantsRepository
        .createRestaurant({
  
          ownerId,
  
          name:
            dto.name,
  
          slug:
            dto.slug,
  
          description:
            dto.description,
  
          phone:
            dto.phone,
  
          email:
            dto.email,
  
        });
  
    }
  
    async getMyRestaurants(
      ownerId: string,
    ) {
  
      return this.restaurantsRepository
        .findRestaurantsByOwner(
          ownerId,
        );
  
    }
  
    async getRestaurantById(
      restaurantId: string,
    ) {
  
      const restaurant =
  
        await this.restaurantsRepository
          .findRestaurantById(
            restaurantId,
          );
  
      if (!restaurant) {
  
        throw new NotFoundException(
          'Restaurant not found',
        );
  
      }
  
      return restaurant;
  
    }
  
  }