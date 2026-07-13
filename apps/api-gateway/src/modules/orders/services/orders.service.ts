import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Inject,
  forwardRef,
} from '@nestjs/common';

import {
  OrderStatus,
  PaymentStatus,
  PaymentMode,
  TransactionStatus,
  AuditAction,
} from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import { OrdersRepository } from '../repositories/orders.repository';

import { CreateOrderDto } from '../dto/create-order.dto';

import { UpdateOrderStatusDto } from '../dto/update-order-status.dto';

import { GetAdminOrdersQueryDto } from '../dto/get-admin-orders-query.dto';
import { GetCustomerOrdersQueryDto } from '../dto/get-customer-orders-query.dto';
import { PaginatedAdminOrdersResponseDto } from '../dto/paginated-admin-orders-response.dto';
import { PaginatedOrdersResponseDto } from '../dto/paginated-orders-response.dto';
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
import { RestaurantsService } from '../../restaurants/services/restaurants.service';
import {
  AddressesService,
  formatAddressForOrder,
} from '../../addresses/services/addresses.service';
import { RealtimeService } from '../../realtime/services/realtime.service';
import {
  AuthenticatedUser,
  canAccessOrder,
  canAccessRestaurant,
} from '../../../shared/authorization/order-access.util';
import { getRestaurantOrderSettings } from '../../../shared/restaurant/restaurant-order-settings.util';
import { QueueService } from '../../../infrastructure/queues/queue.service';
import { AuditService } from '../../audit/services/audit.service';

const TERMINAL_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.DELIVERED,
  OrderStatus.CANCELLED,
];

/**
 * Single order-status state machine, shared by every caller (restaurant/admin-facing
 * PATCH .../status and delivery-partner-facing PATCH /delivery/orders/:id/status) so there is
 * exactly one place that defines what transitions are legal.
 */
const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PENDING]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  [OrderStatus.CONFIRMED]: [OrderStatus.PREPARING, OrderStatus.CANCELLED],
  [OrderStatus.PREPARING]: [OrderStatus.READY_FOR_PICKUP],
  [OrderStatus.READY_FOR_PICKUP]: [OrderStatus.OUT_FOR_DELIVERY],
  [OrderStatus.OUT_FOR_DELIVERY]: [OrderStatus.DELIVERED],
  [OrderStatus.DELIVERED]: [],
  [OrderStatus.CANCELLED]: [],
};

/**
 * Flattens the raw Prisma include shape (menuItem/variant as nested rows, addonOptions as join
 * rows) into the flat, documented OrderItemResponseDto shape.
 */
function flattenOrderItems(items: any[]) {
  return items.map((item) => ({
    ...item,

    menuItemName: item.menuItem?.name,
    menuItem: undefined,

    variantName: item.variant?.name,
    variant: undefined,

    addonOptions: (item.addonOptions ?? []).map((option: any) => ({
      addonOptionId: option.addonOptionId,
      name: option.name,
      price: Number(option.price),
    })),
  }));
}

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
    items: flattenOrderItems(order.items),
    statusHistory: order.statusHistory,
  };
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,

    private readonly ordersRepository: OrdersRepository,
    private readonly eventBus: EventBusService,
    @Inject(forwardRef(() => DeliveryService))
    private readonly deliveryService: DeliveryService,
    private readonly paymentsService: PaymentsService,
    private readonly restaurantsService: RestaurantsService,
    private readonly addressesService: AddressesService,
    private readonly realtimeService: RealtimeService,
    private readonly queueService: QueueService,
    private readonly auditService: AuditService,
  ) {}

  /** Throws unless the acting user is this order's customer, its assigned delivery partner, its restaurant's owner/manager, or an admin. */
  private async assertOrderAccess(
    order: {
      customerId: string;
      restaurantId: string;
      deliveryPartnerId: string | null;
    },
    user: AuthenticatedUser,
  ): Promise<void> {
    const allowed = await canAccessOrder(this.prisma, order, user);

    if (!allowed) {
      throw new ForbiddenException('You do not have access to this order');
    }
  }

  private async assertRestaurantAccess(
    restaurantId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    const allowed = await canAccessRestaurant(this.prisma, restaurantId, user);

    if (!allowed) {
      throw new ForbiddenException(
        "You do not have access to this restaurant's orders",
      );
    }
  }

  /** Lightweight ownership lookup reused by other modules (e.g. tracking) that need to authorize against an order without fetching its full item graph. */
  async getOrderOwnership(orderId: string) {
    const order = await this.ordersRepository.findOrderOwnership(orderId);

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return order;
  }

  /** Throws unless the user can access the given order; returns the ownership record so callers can reuse it. */
  async assertOrderAccessById(orderId: string, user: AuthenticatedUser) {
    const order = await this.getOrderOwnership(orderId);

    await this.assertOrderAccess(order, user);

    return order;
  }

  async placeOrder(
    customerId: string,

    dto: CreateOrderDto,
  ) {
    let deliveryAddress: string;
    let latitude: number | undefined;
    let longitude: number | undefined;
    let addressId: string | undefined;

    if (dto.addressId) {
      const address = await this.addressesService.findByIdForCustomer(
        dto.addressId,
        customerId,
      );

      deliveryAddress = formatAddressForOrder(address);
      latitude = address.latitude ?? undefined;
      longitude = address.longitude ?? undefined;
      addressId = address.id;
    } else if (dto.deliveryAddress) {
      deliveryAddress = dto.deliveryAddress;
    } else {
      throw new BadRequestException(
        'Either addressId or deliveryAddress must be provided',
      );
    }

    const menuItems = await this.prisma.menuItem.findMany({
      where: {
        id: {
          in: dto.items.map((item) => item.menuItemId),
        },
      },

      include: {
        category: true,
        variants: true,
        addons: {
          include: {
            options: true,
          },
        },
      },
    });

    let subtotal = 0;

    const orderItems = dto.items.map((item) => {
      const menuItem = menuItems.find((m) => m.id === item.menuItemId);

      if (!menuItem) {
        throw new NotFoundException('Menu item not found');
      }

      if (menuItem.category.restaurantId !== dto.restaurantId) {
        throw new BadRequestException(
          'All items must belong to the selected restaurant',
        );
      }

      let unitPrice = Number(menuItem.basePrice);

      if (item.variantId) {
        const variant = menuItem.variants.find((v) => v.id === item.variantId);

        if (!variant) {
          throw new BadRequestException(
            `Variant not found for item "${menuItem.name}"`,
          );
        }

        unitPrice = Number(variant.price);
      }

      const optionIndex = new Map(
        menuItem.addons.flatMap((addon) =>
          addon.options.map(
            (option) => [option.id, { option, addon }] as const,
          ),
        ),
      );

      const addonOptionsData = (item.addonOptionIds ?? []).map((optionId) => {
        const entry = optionIndex.get(optionId);

        if (!entry) {
          throw new BadRequestException(
            `Addon option not found for item "${menuItem.name}"`,
          );
        }

        if (!entry.option.isAvailable) {
          throw new BadRequestException(
            `Addon option "${entry.option.name}" is currently unavailable`,
          );
        }

        return {
          addonOptionId: entry.option.id,
          name: entry.option.name,
          price: Number(entry.option.price),
        };
      });

      for (const addon of menuItem.addons) {
        const selectedCount = addonOptionsData.filter((selected) =>
          addon.options.some((option) => option.id === selected.addonOptionId),
        ).length;

        if (
          selectedCount < addon.minSelection ||
          selectedCount > addon.maxSelection
        ) {
          throw new BadRequestException(
            `"${addon.name}" requires between ${addon.minSelection} and ${addon.maxSelection} selections for "${menuItem.name}"`,
          );
        }
      }

      const addonsTotal = addonOptionsData.reduce(
        (sum, option) => sum + option.price,
        0,
      );

      const totalPrice = (unitPrice + addonsTotal) * item.quantity;

      subtotal += totalPrice;

      return {
        menuItemId: item.menuItemId,

        variantId: item.variantId,

        quantity: item.quantity,

        unitPrice,

        totalPrice,

        specialInstructions: item.specialInstructions,

        addonOptions: {
          create: addonOptionsData,
        },
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

      addressId,

      paymentMode: dto.paymentMode ?? PaymentMode.ONLINE,

      orderNumber,

      subtotalAmount: subtotal,

      deliveryFee,

      taxAmount,

      totalAmount,

      deliveryAddress,

      latitude,

      longitude,

      notes: dto.notes,

      items: {
        create: orderItems,
      },
    });

    await this.ordersRepository.createStatusHistory({
      orderId: order.id,

      status: OrderStatus.PENDING,

      changedById: customerId,
    });

    await this.scheduleAcceptanceTimeout(dto.restaurantId, order.id);

    await this.eventBus.publish(
      'order.placed',

      new OrderPlacedEvent(
        order.id,

        customerId,

        dto.restaurantId,
      ),
    );

    return {
      ...order,

      items: flattenOrderItems(order.items),
    };
  }

  /** Schedules the auto-reject/auto-accept timeout job for a newly placed order, using that
   *  restaurant's configured RestaurantSettings.acceptanceTimeoutMinutes (defaults to 10). */
  private async scheduleAcceptanceTimeout(
    restaurantId: string,
    orderId: string,
  ): Promise<void> {
    const { acceptanceTimeoutMinutes } = await getRestaurantOrderSettings(
      this.prisma,
      restaurantId,
    );

    await this.queueService.addOrderAcceptanceTimeoutJob(
      orderId,
      acceptanceTimeoutMinutes * 60 * 1000,
    );
  }

  /**
   * Invoked by OrderAcceptanceTimeoutProcessor once an order's acceptance-timeout job fires.
   * Guarded twice against a race with a manual accept/reject: once here (skip if the order has
   * already left PENDING) and once atomically in the repository's compare-and-swap update, so
   * exactly one of "manual action" or "timeout" ever applies, never both.
   */
  async handleAcceptanceTimeout(orderId: string): Promise<void> {
    const order = await this.ordersRepository.findOrderById(orderId);

    if (!order || order.status !== OrderStatus.PENDING) {
      return;
    }

    const { autoAcceptOrders } = await getRestaurantOrderSettings(
      this.prisma,
      order.restaurantId,
    );

    const nextStatus = autoAcceptOrders
      ? OrderStatus.CONFIRMED
      : OrderStatus.CANCELLED;

    const updatedOrder = await this.ordersRepository.transitionIfPending(
      orderId,
      nextStatus,
    );

    if (!updatedOrder) {
      // Lost the race to a manual accept/reject that landed first — no-op.
      return;
    }

    await this.ordersRepository.createStatusHistory({
      orderId,

      status: nextStatus,

      note: autoAcceptOrders
        ? 'Auto-accepted: acceptance timeout elapsed'
        : 'Auto-rejected: acceptance timeout elapsed',

      changedById: null,
    });

    await this.auditService.log(
      null,
      'Order',
      orderId,
      AuditAction.STATUS_CHANGE,
      { status: OrderStatus.PENDING },
      { status: nextStatus, reason: 'acceptance-timeout' },
    );

    await this.eventBus.publish(
      'order.status.changed',

      new OrderStatusChangedEvent(
        updatedOrder.id,
        updatedOrder.customerId,
        updatedOrder.status,
        updatedOrder.restaurantId,
        Number(updatedOrder.totalAmount),
      ),
    );

    this.realtimeService.emitToOrder(orderId, 'order.status.changed', {
      orderId,
      status: updatedOrder.status,
      updatedAt: updatedOrder.updatedAt,
    });

    this.realtimeService.emitToRestaurant(
      order.restaurantId,
      'order.acceptance-timeout',
      { orderId, status: nextStatus },
    );
  }

  /** Invoked by OrderPaymentListener when a Razorpay payment succeeds. Idempotent — safe to call more than once. */
  async markOrderPaid(orderId: string) {
    const order = await this.ordersRepository.findOrderById(orderId);

    if (!order || order.paymentStatus === PaymentStatus.PAID) {
      return;
    }

    await this.ordersRepository.updatePaymentStatus(
      orderId,
      PaymentStatus.PAID,
    );

    if (order.status === OrderStatus.PENDING) {
      const updatedOrder = await this.ordersRepository.updateOrderStatus(
        orderId,
        OrderStatus.CONFIRMED,
      );

      await this.ordersRepository.createStatusHistory({
        orderId,

        status: OrderStatus.CONFIRMED,
      });

      await this.eventBus.publish(
        'order.status.changed',

        new OrderStatusChangedEvent(
          updatedOrder.id,
          updatedOrder.customerId,
          updatedOrder.status,
          updatedOrder.restaurantId,
        ),
      );
    }
  }

  /** Invoked by OrderPaymentListener when a Razorpay payment fails. */
  async markOrderPaymentFailed(orderId: string) {
    const order = await this.ordersRepository.findOrderById(orderId);

    if (!order || order.paymentStatus === PaymentStatus.PAID) {
      return;
    }

    await this.ordersRepository.updatePaymentStatus(
      orderId,
      PaymentStatus.FAILED,
    );
  }

  async getCustomerOrders(
    customerId: string,
    query: GetCustomerOrdersQueryDto,
  ): Promise<PaginatedOrdersResponseDto> {
    const skip = (query.page - 1) * query.limit;

    const { items, total } = await this.ordersRepository.findCustomerOrders({
      customerId,
      skip,
      take: query.limit,
      search: query.search,
      status: query.status,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
    });

    return {
      items: items.map((order: any) => ({
        ...order,
        restaurantName: order.restaurant?.name,
        restaurant: undefined,
        items: flattenOrderItems(order.items),
      })),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async getRestaurantOrders(restaurantId: string, user: AuthenticatedUser) {
    await this.assertRestaurantAccess(restaurantId, user);

    const orders =
      await this.ordersRepository.findRestaurantOrders(restaurantId);

    return orders.map((order: any) => ({
      ...order,

      items: flattenOrderItems(order.items),
    }));
  }

  /**
   * Restaurant dashboard metrics — every number is aggregated server-side from a bounded,
   * restaurant-scoped window (today for the counters, a rolling 30 days for top items/peak
   * hours). See OrdersRepository.getDashboardWindowOrders/getTopSellingItems/getRecentOrders.
   */
  async getRestaurantDashboard(
    restaurantId: string,
    user: AuthenticatedUser,
    branchId?: string,
  ) {
    await this.assertRestaurantAccess(restaurantId, user);

    const since30Days = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [windowOrders, topSellingItems, recentOrders] = await Promise.all([
      this.ordersRepository.getDashboardWindowOrders(
        restaurantId,
        since30Days,
        branchId,
      ),
      this.ordersRepository.getTopSellingItems(
        restaurantId,
        since30Days,
        5,
        branchId,
      ),
      this.ordersRepository.getRecentOrders(restaurantId, 10, branchId),
    ]);

    const todaysOrders = windowOrders.filter(
      (order) => order.placedAt >= startOfToday,
    );

    const since7Days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const thisWeekOrders = windowOrders.filter(
      (order) => order.placedAt >= since7Days,
    );

    const ordersToday = todaysOrders.length;
    const revenueToday = todaysOrders.reduce(
      (sum, order) => sum + Number(order.totalAmount),
      0,
    );

    // "This week" is the trailing 7 days and "this month" is the full rolling 30-day window
    // already fetched above (not calendar-month-to-date) — both are derived from the same
    // windowOrders fetch, so neither requires an additional query.
    const revenueThisWeek = thisWeekOrders.reduce(
      (sum, order) => sum + Number(order.totalAmount),
      0,
    );
    const revenueThisMonth = windowOrders.reduce(
      (sum, order) => sum + Number(order.totalAmount),
      0,
    );

    const accepted = todaysOrders.filter(
      (order) =>
        order.status !== OrderStatus.PENDING &&
        order.status !== OrderStatus.CANCELLED,
    ).length;
    const rejected = todaysOrders.filter(
      (order) => order.status === OrderStatus.CANCELLED,
    ).length;
    const preparing = todaysOrders.filter(
      (order) => order.status === OrderStatus.PREPARING,
    ).length;
    const ready = todaysOrders.filter(
      (order) => order.status === OrderStatus.READY_FOR_PICKUP,
    ).length;
    const completed = todaysOrders.filter(
      (order) => order.status === OrderStatus.DELIVERED,
    ).length;

    const decided = accepted + rejected;
    const acceptanceRate = decided > 0 ? (accepted / decided) * 100 : 0;
    const cancellationRate =
      ordersToday > 0 ? (rejected / ordersToday) * 100 : 0;

    const prepTimes = todaysOrders
      .filter((order) => order.statusHistory.length > 0)
      .map(
        (order) =>
          (order.statusHistory[0].createdAt.getTime() -
            order.placedAt.getTime()) /
          60000,
      );
    const averagePreparationTimeMinutes =
      prepTimes.length > 0
        ? Math.round(
            prepTimes.reduce((sum, minutes) => sum + minutes, 0) /
              prepTimes.length,
          )
        : undefined;

    const hourCounts = new Map<number, number>();

    for (const order of windowOrders) {
      const hour = order.placedAt.getHours();
      hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1);
    }

    const peakHours = Array.from(hourCounts.entries())
      .map(([hour, orderCount]) => ({ hour, orderCount }))
      .sort((a, b) => b.orderCount - a.orderCount);

    return {
      ordersToday,
      revenueToday,
      revenueThisWeek,
      revenueThisMonth,
      accepted,
      rejected,
      preparing,
      ready,
      completed,
      averagePreparationTimeMinutes,
      acceptanceRate: Math.round(acceptanceRate * 10) / 10,
      cancellationRate: Math.round(cancellationRate * 10) / 10,
      topSellingItems,
      peakHours,
      recentOrders: recentOrders.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        totalAmount: Number(order.totalAmount),
        customerName:
          `${order.customer.firstName} ${order.customer.lastName ?? ''}`.trim(),
        createdAt: order.createdAt,
      })),
    };
  }

  /**
   * The single order-status transition path. Validates the transition, writes the
   * OrderStatusHistory entry, publishes `order.status.changed` for every transition (not just
   * some), and pushes a realtime update to the order's room — used identically whether the
   * caller is the restaurant/admin-facing controller or the delivery-partner-facing one
   * (DeliveryService.updateDeliveryStatus delegates here rather than updating the order itself).
   */
  async updateOrderStatus(
    orderId: string,

    dto: UpdateOrderStatusDto,

    user: AuthenticatedUser,
  ) {
    const order = await this.ordersRepository.findOrderById(orderId);

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    await this.assertOrderAccess(order, user);

    const allowedStatuses = ORDER_STATUS_TRANSITIONS[order.status];

    if (!allowedStatuses.includes(dto.status)) {
      throw new BadRequestException(
        `Invalid status transition from ${order.status} to ${dto.status}`,
      );
    }

    const updatedOrder = await this.ordersRepository.updateOrderStatus(
      orderId,

      dto.status,
    );

    await this.ordersRepository.createStatusHistory({
      orderId,

      status: dto.status,

      note: dto.reason,

      changedById: user.userId,
    });

    await this.eventBus.publish(
      'order.status.changed',

      new OrderStatusChangedEvent(
        updatedOrder.id,

        updatedOrder.customerId,

        updatedOrder.status,

        updatedOrder.restaurantId,

        Number(updatedOrder.totalAmount),
      ),
    );

    this.realtimeService.emitToOrder(orderId, 'order.status.changed', {
      orderId,
      status: updatedOrder.status,
      updatedAt: updatedOrder.updatedAt,
    });

    if (dto.status === OrderStatus.READY_FOR_PICKUP) {
      await this.eventBus.publish(
        'order.ready',

        new OrderReadyEvent(
          updatedOrder.id,

          updatedOrder.restaurantId,
        ),
      );
    }

    if (dto.status === OrderStatus.DELIVERED) {
      await this.recordDeliveryTiming(order.placedAt, updatedOrder);
    }

    return updatedOrder;
  }

  /**
   * Feeds real fulfillment timing back into the restaurant's running averages. Only hooked
   * into the normal status-transition path (not forceCompleteOrder) — a force-completed order
   * is an admin override, not a representative timing sample.
   */
  private async recordDeliveryTiming(
    placedAt: Date,
    order: { id: string; restaurantId: string; deliveredAt: Date | null },
  ): Promise<void> {
    if (!order.deliveredAt) {
      return;
    }

    const deliveryMinutes = Math.round(
      (order.deliveredAt.getTime() - placedAt.getTime()) / 60000,
    );

    const readyEntry = await this.ordersRepository.findStatusHistoryEntry(
      order.id,
      OrderStatus.READY_FOR_PICKUP,
    );

    const prepMinutes = readyEntry
      ? Math.round(
          (readyEntry.createdAt.getTime() - placedAt.getTime()) / 60000,
        )
      : null;

    await this.restaurantsService.recordOrderTiming(
      order.restaurantId,
      prepMinutes,
      deliveryMinutes,
    );
  }

  async getOrderById(orderId: string, user: AuthenticatedUser) {
    const order = await this.ordersRepository.findOrderById(orderId);

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    await this.assertOrderAccess(order, user);

    return {
      ...order,

      items: flattenOrderItems(order.items),

      deliveryPartner: (order as any).deliveryPartner
        ? {
            id: (order as any).deliveryPartner.id,
            firstName: (order as any).deliveryPartner.firstName,
            lastName: (order as any).deliveryPartner.lastName ?? undefined,
            phone: (order as any).deliveryPartner.phone ?? undefined,
            vehicleType: (order as any).deliveryPartner.deliveryPartnerProfile
              ?.vehicleType,
            vehicleNumber: (order as any).deliveryPartner.deliveryPartnerProfile
              ?.vehicleNumber,
          }
        : undefined,
    };
  }

  async getOrderTimeline(orderId: string, user: AuthenticatedUser) {
    const order = await this.getOrderOwnership(orderId);

    await this.assertOrderAccess(order, user);

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
      throw new BadRequestException(
        `Orders with status ${order.status} cannot be reassigned`,
      );
    }

    const partner =
      await this.deliveryService.findPartnerByUserId(deliveryPartnerId);

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
    const [ordersToday, activeOrders, completedOrdersToday] = await Promise.all(
      [
        this.ordersRepository.countPlacedToday(),
        this.ordersRepository.countActive(),
        this.ordersRepository.countDeliveredToday(),
      ],
    );

    return { ordersToday, activeOrders, completedOrdersToday };
  }

  async getAllForAdmin(
    query: GetAdminOrdersQueryDto,
  ): Promise<PaginatedAdminOrdersResponseDto> {
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
      throw new BadRequestException(
        `Orders with status ${order.status} cannot be cancelled`,
      );
    }

    const updatedOrder = await this.ordersRepository.updateOrderStatus(
      orderId,
      OrderStatus.CANCELLED,
    );

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
      throw new BadRequestException(
        `Orders with status ${order.status} cannot be force completed`,
      );
    }

    const updatedOrder = await this.ordersRepository.markDelivered(orderId);

    await this.ordersRepository.createStatusHistory({
      orderId,

      status: OrderStatus.DELIVERED,

      note: dto.reason,
    });

    return updatedOrder;
  }

  /**
   * Resolves the order's active payment and delegates the actual provider refund to
   * PaymentsService — no provider logic duplicated here. Splits the requested refund
   * proportionally across the order's two payment legs (wallet + Razorpay, per the C9 mixed-
   * payment feature): the Razorpay leg is refunded via PaymentsService as before, and the
   * wallet leg is credited back by publishing `order.refunded` for WalletEventListener to
   * consume — OrdersService stays fully decoupled from WalletModule.
   */
  async refundOrder(orderId: string, dto: RefundOrderDto) {
    const order = await this.ordersRepository.findOrderById(orderId);

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const totalAmount = Number(order.totalAmount);
    const walletAmountUsed = Number((order as any).walletAmountUsed ?? 0);
    const requestedAmount = dto.amount ?? totalAmount;
    const refundRatio =
      totalAmount > 0
        ? Math.min(requestedAmount, totalAmount) / totalAmount
        : 0;

    const walletPortion =
      Math.round(walletAmountUsed * refundRatio * 100) / 100;
    const razorpayPortion =
      Math.round((totalAmount - walletAmountUsed) * refundRatio * 100) / 100;

    if (razorpayPortion > 0) {
      const payment =
        await this.paymentsService.findActivePaymentForOrder(orderId);

      if (!payment || payment.status !== TransactionStatus.SUCCESS) {
        throw new BadRequestException(
          'This order has no successful payment to refund',
        );
      }

      await this.paymentsService.refundPayment(
        payment.id,
        razorpayPortion,
        dto.reason,
      );
    }

    if (walletPortion > 0) {
      await this.eventBus.publish('order.refunded', {
        orderId,
        customerId: order.customerId,
        restaurantId: order.restaurantId,
        walletAmount: walletPortion,
      });
    }

    await this.eventBus.publish('order.refunded.restaurant', {
      orderId,
      restaurantId: order.restaurantId,
      amount: Math.round((walletPortion + razorpayPortion) * 100) / 100,
    });

    return this.ordersRepository.updatePaymentStatus(
      orderId,
      PaymentStatus.REFUNDED,
    );
  }
}
