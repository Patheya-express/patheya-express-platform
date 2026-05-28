import {
    Injectable,
  } from '@nestjs/common';
  
  import { PrismaService }
  from '../../../infrastructure/database/prisma.service';
  
  import {
    BaseRepository,
  } from '../../../infrastructure/database/repositories/base.repository';
  
  @Injectable()
  export class RestaurantsRepository
    extends BaseRepository {
  
    constructor(
      prisma: PrismaService,
    ) {
  
      super(prisma);
  
    }
  
    async createRestaurant(
      data: any,
    ) {
  
      return this.prisma.restaurant
        .create({
  
          data,
  
        });
  
    }
  
    async findRestaurantsByOwner(
      ownerId: string,
    ) {
  
      return this.prisma.restaurant
        .findMany({
  
          where: {
            ownerId,
          },
  
          orderBy: {
            createdAt: 'desc',
          },
  
        });
  
    }
  
    async findRestaurantById(
      restaurantId: string,
    ) {
  
      return this.prisma.restaurant
        .findUnique({
  
          where: {
            id: restaurantId,
          },
  
        });
  
    }
  
  }