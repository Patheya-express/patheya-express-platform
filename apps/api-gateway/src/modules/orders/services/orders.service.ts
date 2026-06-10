import {
    Injectable,
    NotFoundException,
    BadRequestException
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
  
  import { EventBusService } from 'src/core/events/event-bus.service';

  import { OrderPlacedEvent }
  from '../events/order-placed.event';

  import { OrderReadyEvent }
  from '../../dispatch/events/order-ready.event';

  @Injectable()
  export class OrdersService {
  
    constructor(
  
      private readonly prisma:
        PrismaService,
  
      private readonly ordersRepository:
        OrdersRepository,
      private readonly eventBus:
        EventBusService
  
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
      await this.eventBus.publish(

          'order.placed',
        
          new OrderPlacedEvent(
        
            order.id,
        
            customerId,
        
            dto.restaurantId,
        
          ),
        
        );
  
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
  
    ) 
    
    {
      const order =
  await this.ordersRepository
    .findOrderById(orderId);

if (!order) {

  throw new NotFoundException(
    'Order not found',
  );

}

const allowedTransitions:
  Record<
    OrderStatus,
    OrderStatus[]
  > = {

  [OrderStatus.PENDING]: [
    OrderStatus.CONFIRMED,
    OrderStatus.CANCELLED,
  ],

  [OrderStatus.CONFIRMED]: [
    OrderStatus.PREPARING,
    OrderStatus.CANCELLED,
  ],

  [OrderStatus.PREPARING]: [
    OrderStatus.READY_FOR_PICKUP,
  ],

  [OrderStatus.READY_FOR_PICKUP]: [
    OrderStatus.OUT_FOR_DELIVERY,
  ],

  [OrderStatus.OUT_FOR_DELIVERY]: [
    OrderStatus.DELIVERED,
  ],

  [OrderStatus.DELIVERED]: [],

  [OrderStatus.CANCELLED]: [],

};
const allowedStatuses =

  allowedTransitions[
    order.status
  ];

if (

  !allowedStatuses.includes(
    dto.status,
  )

) {

  throw new BadRequestException(

    `Invalid status transition from ${order.status} to ${dto.status}`,

  );

}
  
      const updatedOrder =
  
        await this.ordersRepository
          .updateOrderStatus(
  
            orderId,
  
            dto.status,
  
          );
          if (

            dto.status ===
            OrderStatus.READY_FOR_PICKUP
          
          ) {
          
            await this.eventBus.publish(
          
              'order.ready',
          
              new OrderReadyEvent(
          
                updatedOrder.id,
          
                updatedOrder.restaurantId,
          
              ),
          
            );
          
          }
  
      await this.ordersRepository
        .createStatusHistory({
  
          orderId,
  
          status:
            dto.status,
  
        });
  
      return updatedOrder;
  
    }
    async getOrderById(
      orderId: string,
    ) {
    
      return this.ordersRepository
        .findOrderById(
          orderId,
        );
    
    }
    
    async getOrderTimeline(
      orderId: string,
    ) {
    
      return this.ordersRepository
        .getOrderTimeline(
          orderId,
        );
    
    }
    
    async assignDeliveryPartner(
    
      orderId: string,
    
      deliveryPartnerId: string,
    
    ) {
    
      return this.ordersRepository
        .assignDeliveryPartner(
    
          orderId,
    
          deliveryPartnerId,
    
        );
    
    }
  
  }