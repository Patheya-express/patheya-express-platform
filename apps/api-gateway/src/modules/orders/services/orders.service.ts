import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';

import { OrderStatus, PaymentStatus, TransactionStatus } from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import { OrdersRepository } from '../repositories/orders.repository';

import { CreateOrderDto } from '../dto/create-order.dto';

import { UpdateOrderStatusDto } from '../dto/update-order-status.dto';

import { GetAdminOrdersQueryDto } from '../dto/get-admin-orders-query.dto';
import { PaginatedAdminOrdersResponseDto } from '../dto/paginated-admin-orders-response.dto';
import { AdminOrderResponseDto } from '../dto/admin-order-response.dto';
import { CancelOrderDto } from '../dto/cancel-order.dto';
import { ForceCompleteOrderDto } from '../dto/force-complete-order.dto';
import { RefundOrderDto } from '../dto/refund-order.dto';

import { EventBusService } from 'src/core/events/event-bus.service';

import { OrderPlacedEvent } from '../events/order-placed.event';

import { OrderReadyEvent } from '../../dispatch/events/order-ready.event';

import { OrderStatusChangedEvent } from '../events/order-status-changed.event';

import { DeliveryService } from '../../delivery/services/delivery.service';
import { PaymentsService } from '../../payments/services/payments.service';

const TERMINAL_ORDER_STATUSES: OrderStatus[] = [OrderStatus.DELIVERED, OrderStatus.CANCELLED];

/**
 * Flattens the raw Prisma include shape (customer/deliveryPartner as full User rows) into the
 * documented AdminOrderResponseDto shape — critically, this is what keeps passwordHash and
 * every other auth-related field out of admin API responses.
 */
function toAdminOrder(order: any): AdminOrderResponseDto {
  const latestPayment = order.payment?.[0];

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    customerId: order.customerId,
    customer: {
      id: order.customer.id,
      firstName: order.customer.firstName,
      lastName: order.customer.lastName,
      email: order.customer.email,
      phone: order.customer.phone,
    },
    restaurantId: order.restaurantId,
    restaurant: {
      id: order.restaurant.id,
      name: order.restaurant.name,
    },
    deliveryPartnerId: order.deliveryPartnerId ?? undefined,
    deliveryPartner: order.deliveryPartner
      ? {
          id: order.deliveryPartner.id,
          firstName: order.deliveryPartner.firstName,
          lastName: order.deliveryPartner.lastName,
          phone: order.deliveryPartner.phone,
        }
      : undefined,
    status: order.status,
    paymentStatus: order.paymentStatus,
    payment: latestPayment
      ? {
          status: latestPayment.status,
          amount: Number(latestPayment.amount),
          method: latestPayment.method,
          provider: latestPayment.provider,
        }
      : undefined,
    subtotalAmount: order.subtotalAmount,
    deliveryFee: order.deliveryFee,
    taxAmount: order.taxAmount,
    totalAmount: order.totalAmount,
    deliveryAddress: order.deliveryAddress,
    notes: order.notes,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    deliveredAt: order.deliveredAt,
    items: order.items.map((item: any) => ({
      id: item.id,
      menuItemId: item.menuItemId,
      menuItemName: item.menuItem?.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      totalPrice: item.totalPrice,
      specialInstructions: item.specialInstructions,
    })),
    statusHistory: order.statusHistory,
  };
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,

    private readonly ordersRepository: OrdersRepository,
    private readonly eventBus: EventBusService,
    private readonly deliveryService: DeliveryService,
    private readonly paymentsService: PaymentsService,
  ) {}

  async placeOrder(
    customerId: string,

    dto: CreateOrderDto,
  ) {
    const menuItems = await this.prisma.menuItem.findMany({
      where: {
        id: {
          in: dto.items.map((item) => item.menuItemId),
        },
      },
    });

    let subtotal = 0;

    const orderItems = dto.items.map((item) => {
      const menuItem = menuItems.find((m) => m.id === item.menuItemId);

      if (!menuItem) {
        throw new NotFoundException('Menu item not found');
      }

      const unitPrice = Number(menuItem.basePrice);

      const totalPrice = unitPrice * item.quantity;

      subtotal += totalPrice;

      return {
        menuItemId: item.menuItemId,

        quantity: item.quantity,

        unitPrice,

        totalPrice,
      };
    });

    const deliveryFee = 40;

    const taxAmount = subtotal * 0.05;

    const totalAmount = subtotal + deliveryFee + taxAmount;

    const orderNumber = `ORD-${Date.now()}`;

    const order = await this.ordersRepository.createOrder({
      customerId,

      restaurantId: dto.restaurantId,

      branchId: dto.branchId,

      orderNumber,

      subtotalAmount: subtotal,

      deliveryFee,

      taxAmount,

      totalAmount,

      deliveryAddress: dto.deliveryAddress,

      items: {
        create: orderItems,
      },
    });

    await this.ordersRepository.createStatusHistory({
      orderId: order.id,

      status: OrderStatus.PENDING,
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

  async getCustomerOrders(customerId: string) {
    return this.ordersRepository.findCustomerOrders(customerId);
  }

  async getRestaurantOrders(restaurantId: string) {
    const orders =
      await this.ordersRepository.findRestaurantOrders(restaurantId);

    return orders.map((order: any) => ({
      ...order,

      items: order.items.map((item: any) => ({
        ...item,

        menuItemName: item.menuItem?.name,

        menuItem: undefined,
      })),
    }));
  }

  async updateOrderStatus(
    orderId: string,

    dto: UpdateOrderStatusDto,
  ) {
    const order = await this.ordersRepository.findOrderById(orderId);

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const allowedTransitions: Record<OrderStatus, OrderStatus[]> = {
      [OrderStatus.PENDING]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],

      [OrderStatus.CONFIRMED]: [OrderStatus.PREPARING, OrderStatus.CANCELLED],

      [OrderStatus.PREPARING]: [OrderStatus.READY_FOR_PICKUP],

      [OrderStatus.READY_FOR_PICKUP]: [OrderStatus.OUT_FOR_DELIVERY],

      [OrderStatus.OUT_FOR_DELIVERY]: [OrderStatus.DELIVERED],

      [OrderStatus.DELIVERED]: [],

      [OrderStatus.CANCELLED]: [],
    };
    const allowedStatuses = allowedTransitions[order.status];

    if (!allowedStatuses.includes(dto.status)) {
      throw new BadRequestException(
        `Invalid status transition from ${order.status} to ${dto.status}`,
      );
    }

    const updatedOrder = await this.ordersRepository.updateOrderStatus(
      orderId,

      dto.status,
    );
    if (dto.status === OrderStatus.READY_FOR_PICKUP) {
      await this.eventBus.publish(
        'order.ready',

        new OrderReadyEvent(
          updatedOrder.id,

          updatedOrder.restaurantId,
        ),
      );
      await this.eventBus.publish(
        'order.status.changed',

        new OrderStatusChangedEvent(
          updatedOrder.id,

          updatedOrder.customerId,

          updatedOrder.status,
        ),
      );
    }

    await this.ordersRepository.createStatusHistory({
      orderId,

      status: dto.status,
    });

    return updatedOrder;
  }
  async getOrderById(orderId: string) {
    const order = await this.ordersRepository.findOrderById(orderId);

    if (!order) {
      return order;
    }

    return {
      ...order,

      items: order.items.map((item: any) => ({
        ...item,

        menuItemName: item.menuItem?.name,

        menuItem: undefined,
      })),
    };
  }

  async getOrderTimeline(orderId: string) {
    return this.ordersRepository.getOrderTimeline(orderId);
  }

  async assignDeliveryPartner(
    orderId: string,

    deliveryPartnerId: string,
  ) {
    const order = await this.ordersRepository.findOrderById(orderId);

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (TERMINAL_ORDER_STATUSES.includes(order.status)) {
      throw new BadRequestException(`Orders with status ${order.status} cannot be reassigned`);
    }

    const partner = await this.deliveryService.findPartnerByUserId(deliveryPartnerId);

    if (!partner) {
      throw new NotFoundException('Delivery partner not found');
    }

    return this.ordersRepository.assignDeliveryPartner(
      orderId,

      deliveryPartnerId,
    );
  }

  async getDashboardOrderCounts(): Promise<{
    ordersToday: number;
    activeOrders: number;
    completedOrdersToday: number;
  }> {
    const [ordersToday, activeOrders, completedOrdersToday] = await Promise.all([
      this.ordersRepository.countPlacedToday(),
      this.ordersRepository.countActive(),
      this.ordersRepository.countDeliveredToday(),
    ]);

    return { ordersToday, activeOrders, completedOrdersToday };
  }

  async getAllForAdmin(query: GetAdminOrdersQueryDto): Promise<PaginatedAdminOrdersResponseDto> {
    const skip = (query.page - 1) * query.limit;

    const { items, total } = await this.ordersRepository.findAllForAdmin({
      skip,

      take: query.limit,

      search: query.search,

      status: query.status,

      restaurantId: query.restaurantId,

      customerId: query.customerId,

      deliveryPartnerId: query.deliveryPartnerId,

      dateFrom: query.dateFrom,

      dateTo: query.dateTo,
    });

    return {
      items: items.map((order) => toAdminOrder(order)),

      total,

      page: query.page,

      limit: query.limit,

      totalPages: Math.ceil(total / query.limit),
    };
  }

  /** Admin-only override of the customer/restaurant-facing cancel — allows cancelling from any non-terminal status. */
  async adminCancelOrder(orderId: string, dto: CancelOrderDto) {
    const order = await this.ordersRepository.findOrderById(orderId);

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (TERMINAL_ORDER_STATUSES.includes(order.status)) {
      throw new BadRequestException(`Orders with status ${order.status} cannot be cancelled`);
    }

    const updatedOrder = await this.ordersRepository.updateOrderStatus(orderId, OrderStatus.CANCELLED);

    await this.ordersRepository.createStatusHistory({
      orderId,

      status: OrderStatus.CANCELLED,

      note: dto.reason,
    });

    return updatedOrder;
  }

  /** Admin-only escape hatch — skips the linear status pipeline and marks the order delivered directly. */
  async forceCompleteOrder(orderId: string, dto: ForceCompleteOrderDto) {
    const order = await this.ordersRepository.findOrderById(orderId);

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (TERMINAL_ORDER_STATUSES.includes(order.status)) {
      throw new BadRequestException(`Orders with status ${order.status} cannot be force completed`);
    }

    const updatedOrder = await this.ordersRepository.markDelivered(orderId);

    await this.ordersRepository.createStatusHistory({
      orderId,

      status: OrderStatus.DELIVERED,

      note: dto.reason,
    });

    return updatedOrder;
  }

  /** Resolves the order's active payment and delegates the actual refund to PaymentsService — no provider logic duplicated here. */
  async refundOrder(orderId: string, dto: RefundOrderDto) {
    const order = await this.ordersRepository.findOrderById(orderId);

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const payment = await this.paymentsService.findActivePaymentForOrder(orderId);

    if (!payment || payment.status !== TransactionStatus.SUCCESS) {
      throw new BadRequestException('This order has no successful payment to refund');
    }

    const refundAmount = dto.amount ?? Number(payment.amount);

    await this.paymentsService.refundPayment(payment.id, refundAmount, dto.reason);

    return this.ordersRepository.updatePaymentStatus(orderId, PaymentStatus.REFUNDED);
  }
}
