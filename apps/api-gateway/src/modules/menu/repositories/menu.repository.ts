import {
    Injectable,
  } from '@nestjs/common';
  
  import { PrismaService }
  from '../../../infrastructure/database/prisma.service';
  
  import {
    BaseRepository,
  } from '../../../infrastructure/database/repositories/base.repository';
  
  @Injectable()
  export class MenuRepository
    extends BaseRepository {
  
    constructor(
      prisma: PrismaService,
    ) {
  
      super(prisma);
  
    }
  
    async createCategory(
      data: any,
    ) {
  
      return this.prisma
        .menuCategory
        .create({
  
          data,
  
        });
  
    }
  
    async createMenuItem(
      data: any,
    ) {
  
      return this.prisma
        .menuItem
        .create({
  
          data,
  
        });
  
    }
  
    async getRestaurantMenu(
      restaurantId: string,
    ) {
  
      return this.prisma
        .menuCategory
        .findMany({
  
          where: {
            restaurantId,
          },
  
          include: {
  
            menuItems: {
  
              include: {
  
                variants: true,
  
                addons: {
  
                  include: {
  
                    options: true,
  
                  },
  
                },
  
              },
  
            },
  
          },
  
        });
  
    }
  
  }