import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
  Inject,
  forwardRef,
} from '@nestjs/common';

import { randomBytes } from 'crypto';

import {
  OrderStatus,
  PaymentStatus,
  PaymentMode,
  TransactionStatus,
  AuditAction,
  UserRole,
  DeliveryProofType,
  DeliveryProofOtpStatus,
  Prisma,
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

import { EventBusService } from '../../../core/events/event-bus.service';

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
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { AuditService } from '../../audit/services/audit.service';
import { AppLoggerService } from '../../../infrastructure/logger/logger.service';
import { PricingEngineService } from '../../pricing/pricing.service';
import { CouponsService } from '../../coupons/services/coupons.service';

const TERMINAL_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.DELIVERED,
  OrderStatus.CANCELLED,
];

/**
 * How long the fast-path placement lock (see placeOrder) is held for, worst-case. Generous
 * relative to the normal sub-second pipeline duration so a slow-but-legitimate request is never
 * pre-empted by its own retry; just a safety net if the holder crashes before its `finally`
 * releases the lock — the DB unique constraint on (customerId, idempotencyKey) remains correct
 * regardless of what this TTL is set to, so this value is a latency/UX tuning knob, not a
 * correctness one.
 */
const ORDER_PLACEMENT_LOCK_TTL_MS = 30_000;

/** Amounts within a paisa of each other are treated as equal — same tolerance
 *  PaymentsService/PaymentsRepository use for their own refund-amount comparisons. */
const AMOUNT_TOLERANCE = 0.01;

/**
 * Sprint 1.2A review finding: the previous `ORD-${Date.now()}` scheme has no collision
 * resistance under real concurrency — two unrelated orders placed in the same millisecond
 * (entirely plausible multi-restaurant platform traffic, not a contrived edge case) generate the
 * identical orderNumber and the losing request's createOrder() crashes on `orders.orderNumber`'s
 * existing @unique constraint. That failure is unrelated to and NOT caught by the
 * idempotency-key P2002 handling in placeOrder() (it's a different unique index), so it would
 * have surfaced as an opaque 500 for a perfectly legitimate, distinct order.
 *
 * Fix: a UTC date prefix (human-readable, lets support/admin search "today's orders" via the
 * existing `contains` search on this same field — see OrdersRepository.findCustomerOrders/
 * findAllForAdmin, unchanged) plus 24 bits of random suffix (~16.7M values/day — collision
 * probability only becomes meaningful in the thousands of orders/day range, at which point the
 * pre-existing `orders.orderNumber` unique constraint still fails closed rather than silently
 * duplicating). Not sequential/predictable (no information about order volume or ordering is
 * leaked), not a UUID (kept short and human-speakable for phone/support use, matching how
 * orderNumber is actually displayed — see OrderDetailsPage, admin/restaurant/delivery dashboards,
 * and the Razorpay payment description). No schema change: `orderNumber` was already a plain
 * `String @unique` column with no format assumption baked into it anywhere.
 */
function generateOrderNumber(): string {
  const now = new Date();
  const datePart =
    `${now.getUTCFullYear()}` +
    `${String(now.getUTCMonth() + 1).padStart(2, '0')}` +
    `${String(now.getUTCDate()).padStart(2, '0')}`;
  const randomPart = randomBytes(3).toString('hex').toUpperCase();

  return `ORD-${datePart}-${randomPart}`;
}

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
 * Layered on top of assertOrderAccess's identity/ownership check (production-validation audit
 * finding): that check alone only confirms the caller has *some* relationship to the order
 * (customer/assigned partner/restaurant staff/admin), not that they're the *right* relationship
 * for the specific transition requested — meaning, before this fix, a customer could call
 * POST /orders/:id/ready or /picked-up, or an assigned delivery partner could call /accept or
 * /prepare, and it would silently succeed. CANCELLED is deliberately excluded from both lists
 * below and left unrestricted, since customer self-cancel, restaurant reject, and admin override
 * are all pre-existing, intentional paths through that same status value — only the
 * restaurant-only and delivery-partner-only *advancing* transitions are newly role-scoped here.
 */
const RESTAURANT_ONLY_STATUSES: OrderStatus[] = [
  OrderStatus.CONFIRMED,
  OrderStatus.PREPARING,
  OrderStatus.READY_FOR_PICKUP,
];

const DELIVERY_PARTNER_ONLY_STATUSES: OrderStatus[] = [
  OrderStatus.OUT_FOR_DELIVERY,
  OrderStatus.DELIVERED,
];

/**
 * Delivery Proof & Trust (Sprint 4.1) — the proof-of-pickup/proof-of-delivery OTP type that must
 * have a VERIFIED DeliveryProofOtp row before a delivery partner (not admin — see the isAdmin
 * bypass in assertProofVerifiedForStatus) may advance an order to that status. Closes the gap
 * this sprint exists for: previously a delivery partner could call this same
 * updateOrderStatus/assertActorAllowedForStatus path directly (via either
 * PATCH /orders/:orderId/status or PATCH /delivery/orders/:orderId/status — both land here) and
 * flip OUT_FOR_DELIVERY/DELIVERED with zero customer-side confirmation. ProofService.verify()
 * marks the OTP VERIFIED *before* calling into this same updateOrderStatus method, so the proof
 * flow itself always satisfies this check by construction.
 */
const REQUIRED_PROOF_TYPE_FOR_STATUS: Partial<
  Record<OrderStatus, DeliveryProofType>
> = {
  [OrderStatus.OUT_FOR_DELIVERY]: DeliveryProofType.PICKUP,
  [OrderStatus.DELIVERED]: DeliveryProofType.DELIVERY,
};

const RESTAURANT_STAFF_ROLES: UserRole[] = [
  UserRole.RESTAURANT_OWNER,
  UserRole.RESTAURANT_MANAGER,
];

const ADMIN_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.SUPER_ADMIN];

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
    couponId: order.couponId ?? undefined,
    discountAmount: order.discountAmount,
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
    private readonly redisService: RedisService,
    private readonly auditService: AuditService,
    private readonly logger: AppLoggerService,
    private readonly pricingEngineService: PricingEngineService,
    private readonly couponsService: CouponsService,
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

  /** See RESTAURANT_ONLY_STATUSES/DELIVERY_PARTNER_ONLY_STATUSES' doc comment — this is the
   *  role-appropriateness check layered on top of assertOrderAccess's identity check. */
  private assertActorAllowedForStatus(
    status: OrderStatus,
    user: AuthenticatedUser,
  ): void {
    if (RESTAURANT_ONLY_STATUSES.includes(status)) {
      if (
        !RESTAURANT_STAFF_ROLES.includes(user.role) &&
        !ADMIN_ROLES.includes(user.role)
      ) {
        throw new ForbiddenException(
          `Only restaurant staff can mark an order as ${status}`,
        );
      }

      return;
    }

    if (DELIVERY_PARTNER_ONLY_STATUSES.includes(status)) {
      if (
        user.role !== UserRole.DELIVERY_PARTNER &&
        !ADMIN_ROLES.includes(user.role)
      ) {
        throw new ForbiddenException(
          `Only the assigned delivery partner can mark an order as ${status}`,
        );
      }

      return;
    }
  }

  /** See REQUIRED_PROOF_TYPE_FOR_STATUS's doc comment. Admins bypass this (support overrides), matching the isAdmin escape hatch already used throughout the delivery/dispatch/tracking modules. */
  private async assertProofVerifiedForStatus(
    orderId: string,
    status: OrderStatus,
    user: AuthenticatedUser,
  ): Promise<void> {
    if (user.role !== UserRole.DELIVERY_PARTNER) {
      return;
    }

    const requiredType = REQUIRED_PROOF_TYPE_FOR_STATUS[status];

    if (!requiredType) {
      return;
    }

    const otp = await this.prisma.deliveryProofOtp.findUnique({
      where: { orderId_type: { orderId, type: requiredType } },
    });

    if (!otp || otp.status !== DeliveryProofOtpStatus.VERIFIED) {
      throw new ForbiddenException(
        `A verified ${requiredType.toLowerCase()} OTP is required before marking this order as ${status}`,
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

  /**
   * Enterprise order idempotency (Sprint 1.2). `dto.idempotencyKey` is a client-generated UUID,
   * one per checkout attempt, reused verbatim on any retry of that same attempt (double-click,
   * network timeout, browser/mobile resubmit, proxy retry). Two layers, in order:
   *
   *  1. Fast path — a single indexed lookup on (customerId, idempotencyKey). If a row already
   *     exists for this key (the attempt already succeeded, however long ago), return it
   *     unchanged: no new order, no re-running pricing/coupon/payment logic, no duplicate side
   *     effects of any kind. This alone covers the overwhelming majority of real retries (the
   *     client got a timeout/disconnect but the first request actually succeeded server-side).
   *
   *  2. Durable correctness — the DB's own @@unique([customerId, idempotencyKey]) constraint on
   *     Order (see schema.prisma) guarantees at most one row can ever exist for a given key, even
   *     under true concurrency (two requests racing past step 1 before either has committed).
   *     If this request's own createOrder() loses that race, its insert fails with Prisma P2002;
   *     that's caught below and the winning row is fetched and returned instead — never a 500,
   *     never a second order. This guarantee holds unconditionally, with zero dependency on Redis
   *     or any other infrastructure being available.
   *
   * A short-lived Redis advisory lock (tryLock) sits in front of step 2 purely as a latency/UX
   * optimization: it lets a rapid duplicate (e.g. 5 retries in 300ms from a flaky connection)
   * fail fast with a clear "already processing" error instead of every copy redundantly
   * re-running menu lookups/pricing/coupon validation before being disambiguated at the final
   * insert. It is explicitly best-effort and fails OPEN: if Redis is unavailable, that's caught,
   * logged, and placement proceeds without the fast lock — correctness is carried entirely by #2
   * above regardless.
   */
  async placeOrder(
    customerId: string,

    dto: CreateOrderDto,
  ) {
    const existingOrder = await this.ordersRepository.findOrderByIdempotencyKey(
      customerId,
      dto.idempotencyKey,
    );

    if (existingOrder) {
      this.logger.log(
        {
          event: 'order_placement_idempotent_replay',
          customerId,
          idempotencyKey: dto.idempotencyKey,
          orderId: existingOrder.id,
        },
        'OrdersService',
      );

      return {
        ...existingOrder,

        items: flattenOrderItems(existingOrder.items),
      };
    }

    const lockKey = `order-placement-lock:${customerId}:${dto.idempotencyKey}`;
    let lockAcquired = false;

    try {
      lockAcquired = await this.redisService.tryLock(
        lockKey,
        ORDER_PLACEMENT_LOCK_TTL_MS,
      );

      if (!lockAcquired) {
        throw new ConflictException(
          'A request with this idempotency key is already being processed. Please retry shortly.',
        );
      }
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }

      // Redis unavailable/erroring — proceed without the fast-path lock. Correctness is still
      // fully guaranteed by the DB unique constraint caught around createOrder() below.
      this.logger.warn(
        {
          event: 'order_placement_lock_unavailable',
          customerId,
          idempotencyKey: dto.idempotencyKey,
          error: error instanceof Error ? error.message : String(error),
        },
        'OrdersService',
      );
    }

    try {
      return await this.placeOrderInternal(customerId, dto);
    } finally {
      if (lockAcquired) {
        await this.redisService.releaseLock(lockKey).catch(() => {
          // Best-effort — worst case the TTL expires it later; never let cleanup failure mask
          // the real result of order placement.
        });
      }
    }
  }

  /** The actual placement pipeline, unchanged from before Sprint 1.2 except for
   *  (a) threading idempotencyKey into the created row and (b) the P2002 race-loss handling
   *  around createOrder(). Split out from placeOrder() purely so the idempotency/locking
   *  wrapper above stays readable — no behavioral significance to the split itself. */
  private async placeOrderInternal(customerId: string, dto: CreateOrderDto) {
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

    const pricingPreview = this.pricingEngineService.calculate(orderItems);

    // Sprint 1.3: this atomically claims the usage slot (SERIALIZABLE transaction + conditional
    // update — see CouponsRepository.reserveRedemption) BEFORE the order is created, so an order
    // is never created carrying a discount that turns out to be invalid under concurrent load.
    // If order creation below doesn't pan out for any reason, this claim is released again (see
    // the catch block) — a failed/superseded attempt must never permanently consume a slot.
    const reservation = dto.couponCode
      ? await this.couponsService.reserveRedemption(
          customerId,
          dto.couponCode,
          dto.restaurantId,
          pricingPreview.subtotal,
        )
      : null;

    const coupon = reservation?.coupon ?? null;

    const pricing = coupon
      ? this.pricingEngineService.calculate(orderItems, coupon)
      : pricingPreview;

    const orderNumber = generateOrderNumber();

    let order;

    try {
      order = await this.ordersRepository.createOrder({
        customerId,

        restaurantId: dto.restaurantId,

        branchId: dto.branchId,

        addressId,

        paymentMode: dto.paymentMode ?? PaymentMode.ONLINE,

        orderNumber,

        idempotencyKey: dto.idempotencyKey,

        subtotalAmount: pricing.subtotal,

        deliveryFee: pricing.deliveryFee,

        taxAmount: pricing.taxAmount,

        couponId: coupon?.id,

        discountAmount: pricing.discountAmount,

        totalAmount: pricing.totalAmount,

        deliveryAddress,

        latitude,

        longitude,

        notes: dto.notes,

        items: {
          create: orderItems,
        },
      });
    } catch (error) {
      // The order attempt did not produce a real order — whatever coupon slot was reserved above
      // must not be left permanently consumed (Sprint 1.3: "cancelled/failed attempts release
      // coupon usage"). Applies to every failure path below, not just the idempotency-race one.
      if (reservation) {
        await this.couponsService.releaseRedemption(
          reservation.coupon.id,
          reservation.redemptionId,
        );
      }

      // Lost a race to a concurrent request for the SAME idempotency key that committed first
      // (possible whenever the fast-path lock above didn't run — Redis was down — or two
      // requests both landed inside the same lock's TTL window). The unique
      // (customerId, idempotencyKey) index guarantees the row that's now visible IS the one
      // order for this attempt: fetch and return it rather than surfacing an error or, worse,
      // silently creating a duplicate.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const winner = await this.ordersRepository.findOrderByIdempotencyKey(
          customerId,
          dto.idempotencyKey,
        );

        if (winner) {
          this.logger.log(
            {
              event: 'order_placement_lost_race',
              customerId,
              idempotencyKey: dto.idempotencyKey,
              orderId: winner.id,
            },
            'OrdersService',
          );

          return {
            ...winner,

            items: flattenOrderItems(winner.items),
          };
        }
      }

      throw error;
    }

    if (reservation) {
      await this.couponsService.finalizeRedemption(
        reservation.redemptionId,
        order.id,
        pricing.discountAmount,
      );
    }

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

    this.assertActorAllowedForStatus(dto.status, user);

    await this.assertProofVerifiedForStatus(orderId, dto.status, user);

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

      this.logger.log(
        {
          event: 'order_ready_event_published',
          orderId: updatedOrder.id,
          restaurantId: updatedOrder.restaurantId,
        },
        'OrdersService',
      );
    }

    if (dto.status === OrderStatus.DELIVERED) {
      await this.recordDeliveryTiming(order.placedAt, updatedOrder);

      if (updatedOrder.deliveryPartnerId) {
        await this.deliveryService.releasePartnerFromDelivery(
          updatedOrder.deliveryPartnerId,
        );
      }
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

    // Admin cancel is the one path that can reach CANCELLED from READY_FOR_PICKUP/
    // OUT_FOR_DELIVERY (ORDER_STATUS_TRANSITIONS doesn't allow it, but adminCancelOrder
    // deliberately bypasses that table) — so a partner who already accepted/is out delivering
    // this order must be released back to AVAILABLE, or they'd be stuck ON_DELIVERY forever.
    if (order.deliveryPartnerId) {
      await this.deliveryService.releasePartnerFromDelivery(
        order.deliveryPartnerId,
      );
    }

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

    if (order.deliveryPartnerId) {
      await this.deliveryService.releasePartnerFromDelivery(
        order.deliveryPartnerId,
      );
    }

    return updatedOrder;
  }

  /**
   * Resolves the order's active payment and delegates the actual provider refund to
   * PaymentsService — no provider logic duplicated here. Splits the requested refund
   * proportionally across the order's two payment legs (wallet + Razorpay, per the C9 mixed-
   * payment feature): the Razorpay leg is refunded via PaymentsService as before, and the
   * wallet leg is credited back by publishing `order.refunded` for WalletEventListener to
   * consume — OrdersService stays fully decoupled from WalletModule.
   *
   * Sprint 1.8. `actorId` is the acting admin's id, for audit attribution — previously not
   * captured at all. The whole method is now gated behind one atomic order-level claim
   * (Order.paymentStatus PAID→REFUNDED, OrdersRepository.claimPaymentStatusTransition, same
   * conditional-updateMany philosophy as PaymentsRepository.claimStatusTransition), taken BEFORE
   * anything else — two concurrent refund requests for the same order (duplicate browser retry,
   * two admin clicks, a cancel racing a refund) can now only ever have one winner; every other
   * caller's claim affects zero rows and returns a clean, cheap "already refunded" conflict
   * instead of silently redoing the Razorpay call, the wallet credit, and the coupon release a
   * second time. If the refund attempt then fails after the claim already committed (Razorpay
   * error, an invalid amount), the claim is explicitly reverted (REFUNDED→PAID) in the catch
   * block below — a single local compensating update, not a saga — so the order stays in a
   * consistent, retryable state rather than being stuck showing "refunded" with no money moved.
   */
  async refundOrder(orderId: string, dto: RefundOrderDto, actorId: string) {
    const order = await this.ordersRepository.findOrderById(orderId);

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const claim = await this.ordersRepository.claimPaymentStatusTransition(
      orderId,

      [PaymentStatus.PAID],

      PaymentStatus.REFUNDED,
    );

    if (claim.count === 0) {
      throw new ConflictException(
        'This order has already been refunded, or has no paid balance to refund',
      );
    }

    try {
      const totalAmount = Number(order.totalAmount);
      const walletAmountUsed = Number((order as any).walletAmountUsed ?? 0);
      const requestedAmount = dto.amount ?? totalAmount;

      // Fail safely on an over-large request rather than the old silent clamp-to-total — an
      // admin asking to refund more than the order cost is almost certainly a mistake, not an
      // intentional "just refund everything."
      if (requestedAmount > totalAmount + AMOUNT_TOLERANCE) {
        throw new BadRequestException(
          `Refund amount cannot exceed the order total (${totalAmount.toFixed(2)})`,
        );
      }

      const refundRatio = totalAmount > 0 ? requestedAmount / totalAmount : 0;

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
          actorId,
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

      // "Coupon redemption is never released after refund/cancel" (confirmed finding) — best-
      // effort, idempotent on its own terms too (see CouponsService.releaseForOrder).
      await this.couponsService.releaseForOrder(orderId);

      const totalRefunded =
        Math.round((walletPortion + razorpayPortion) * 100) / 100;

      await this.eventBus.publish('order.refund.completed', {
        orderId,
        customerId: order.customerId,
        restaurantId: order.restaurantId,
        amount: totalRefunded,
      });

      await this.auditService.log(
        actorId,
        'Order',
        orderId,
        AuditAction.STATUS_CHANGE,
        { paymentStatus: PaymentStatus.PAID },
        {
          event: 'ORDER_REFUNDED',
          paymentStatus: PaymentStatus.REFUNDED,
          amount: totalRefunded,
          reason: dto.reason,
        },
      );

      this.logger.log(
        {
          event: 'order_refunded',
          orderId,
          walletPortion,
          razorpayPortion,
          actorId,
        },
        'OrdersService',
      );

      return (await this.ordersRepository.findOrderById(orderId))!;
    } catch (error) {
      const revert = await this.ordersRepository.claimPaymentStatusTransition(
        orderId,

        [PaymentStatus.REFUNDED],

        PaymentStatus.PAID,
      );

      if (revert.count !== 1) {
        // Should be unreachable — this call held the exclusive REFUNDED claim on this order, so
        // nothing else could have moved it in between. Logged loudly, not silently ignored.
        this.logger.error(
          {
            event: 'order_refund_revert_count_mismatch',
            orderId,
            revertCount: revert.count,
          },
          undefined,
          'OrdersService',
        );
      }

      throw error;
    }
  }
}
