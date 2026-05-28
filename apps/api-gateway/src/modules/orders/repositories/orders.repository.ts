import {
    Injectable,
  } from '@nestjs/common';
  
  import { PrismaService }
  from '../../../infrastructure/database/prisma.service';
  
  import {
    BaseRepository,
  } from '../../../infrastructure/database/repositories/base.repository';
  
  @Injectable()
  export class OrdersRepository
    extends BaseRepository {
  
    constructor(
      prisma: PrismaService,
    ) {
  
      super(prisma);
  
    }
  
    async createOrder(
      data: any,
    ) {
  
      return this.prisma.order
        .create({
  
          data,
  
          include: {
  
            items: true,
  
          },
  
        });
  
    }
  
    async findCustomerOrders(
      customerId: string,
    ) {
  
      return this.prisma.order
        .findMany({
  
          where: {
            customerId,
          },
  
          include: {
  
            items: true,
  
            restaurant: true,
  
          },
  
          orderBy: {
            createdAt: 'desc',
          },
  
        });
  
    }
  
    async findRestaurantOrders(
      restaurantId: string,
    ) {
  
      return this.prisma.order
        .findMany({
  
          where: {
            restaurantId,
          },
  
          include: {
  
            items: true,
  
            customer: true,
  
          },
  
          orderBy: {
            createdAt: 'desc',
          },
  
        });
  
    }
  
    async updateOrderStatus(
  
      orderId: string,
  
      status: any,
  
    ) {
  
      return this.prisma.order
        .update({
  
          where: {
            id: orderId,
          },
  
          data: {
            status,
          },
  
        });
  
    }
  
    async createStatusHistory(
      data: any,
    ) {
  
      return this.prisma
        .orderStatusHistory
        .create({
  
          data,
  
        });
  
    }
  
  }