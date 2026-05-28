import {
    Injectable,
    NotFoundException,
  } from '@nestjs/common';
  
  import {
    OrderStatus,
  } from '@prisma/client';
  
  import { PrismaService }
  from '../../../infrastructure/database/prisma.service';
  
  import { OrdersRepository }
  from '../repositories/orders.repository';
  
  import { CreateOrderDto }
  from '../dto/create-order.dto';
  
  import { UpdateOrderStatusDto }
  from '../dto/update-order-status.dto';
  
  @Injectable()
  export class OrdersService {
  
    constructor(
  
      private readonly prisma:
        PrismaService,
  
      private readonly ordersRepository:
        OrdersRepository,
  
    ) {}
  
    async placeOrder(
  
      customerId: string,
  
      dto: CreateOrderDto,
  
    ) {
  
      const menuItems =
  
        await this.prisma.menuItem
          .findMany({
  
            where: {
  
              id: {
  
                in: dto.items.map(
                  (item) =>
                    item.menuItemId,
                ),
  
              },
  
            },
  
          });
  
      let subtotal = 0;
  
      const orderItems =
        dto.items.map((item) => {
  
          const menuItem =
            menuItems.find(
  
              (m) =>
                m.id
                === item.menuItemId,
  
            );
  
          if (!menuItem) {
  
            throw new NotFoundException(
              'Menu item not found',
            );
  
          }
  
          const unitPrice =
            Number(
              menuItem.basePrice,
            );
  
          const totalPrice =
            unitPrice
            * item.quantity;
  
          subtotal += totalPrice;
  
          return {
  
            menuItemId:
              item.menuItemId,
  
            quantity:
              item.quantity,
  
            unitPrice,
  
            totalPrice,
  
          };
  
        });
  
      const deliveryFee = 40;
  
      const taxAmount =
        subtotal * 0.05;
  
      const totalAmount =
        subtotal
        + deliveryFee
        + taxAmount;
  
      const orderNumber =
  
        `ORD-${Date.now()}`;
  
      const order =
  
        await this.ordersRepository
          .createOrder({
  
            customerId,
  
            restaurantId:
              dto.restaurantId,
  
            branchId:
              dto.branchId,
  
            orderNumber,
  
            subtotalAmount:
              subtotal,
  
            deliveryFee,
  
            taxAmount,
  
            totalAmount,
  
            deliveryAddress:
              dto.deliveryAddress,
  
            items: {
  
              create:
                orderItems,
  
            },
  
          });
  
      await this.ordersRepository
        .createStatusHistory({
  
          orderId:
            order.id,
  
          status:
            OrderStatus.PENDING,
  
        });
  
      return order;
  
    }
  
    async getCustomerOrders(
      customerId: string,
    ) {
  
      return this.ordersRepository
        .findCustomerOrders(
          customerId,
        );
  
    }
  
    async getRestaurantOrders(
      restaurantId: string,
    ) {
  
      return this.ordersRepository
        .findRestaurantOrders(
          restaurantId,
        );
  
    }
  
    async updateOrderStatus(
  
      orderId: string,
  
      dto: UpdateOrderStatusDto,
  
    ) {
  
      const updatedOrder =
  
        await this.ordersRepository
          .updateOrderStatus(
  
            orderId,
  
            dto.status,
  
          );
  
      await this.ordersRepository
        .createStatusHistory({
  
          orderId,
  
          status:
            dto.status,
  
        });
  
      return updatedOrder;
  
    }
  
  }