import {
  NotificationChannel,
  NotificationType,
  OrderStatus,
  PaymentMode,
  PaymentStatus,
  PrismaClient,
} from '@prisma/client';

import { FLAGSHIP_RESTAURANT_SLUGS } from './erph2a-flagship-restaurants';

const DELIVERY_FEE = 40;
const TAX_RATE = 0.05;

/**
 * A spread of "today" orders across every status the restaurant dashboard reports on (accepted,
 * rejected/cancelled, preparing, ready, completed, plus one still-PENDING order so the
 * acceptance-timeout job has something real to expire against in a dev environment) and across
 * several different hours of the day, so peak-hours/top-selling-items aggregation has more than
 * a single data point. Distinct from 09-orders.seed.ts, which focuses on the customer-facing
 * order-history/live-tracking demo for a single restaurant.
 */
const DEMO_ORDER_PLAN: Array<{ hour: number; status: OrderStatus }> = [
  { hour: 9, status: OrderStatus.DELIVERED },
  { hour: 12, status: OrderStatus.DELIVERED },
  { hour: 13, status: OrderStatus.CANCELLED },
  { hour: 18, status: OrderStatus.PREPARING },
  { hour: 19, status: OrderStatus.READY_FOR_PICKUP },
];

function todayAt(hour: number): Date {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  return date;
}

function historyForStatus(status: OrderStatus): OrderStatus[] {
  const pipeline = [
    OrderStatus.PENDING,
    OrderStatus.CONFIRMED,
    OrderStatus.PREPARING,
    OrderStatus.READY_FOR_PICKUP,
    OrderStatus.OUT_FOR_DELIVERY,
    OrderStatus.DELIVERED,
  ];

  if (status === OrderStatus.CANCELLED) {
    return [OrderStatus.PENDING, OrderStatus.CANCELLED];
  }

  return pipeline.slice(0, pipeline.indexOf(status) + 1);
}

export async function seedRestaurantDashboardDemoOrders(prisma: PrismaClient): Promise<void> {
  console.log('📊 Seeding restaurant dashboard demo orders...');

  const customer = await prisma.user.findUnique({
    where: { email: 'customer@patheyaexpress.com' },
  });

  if (!customer) {
    console.log('⚠️  Skipping dashboard demo orders — seed customer not found.');
    return;
  }

  let orderCount = 0;
  let notificationCount = 0;

  for (const slug of FLAGSHIP_RESTAURANT_SLUGS) {
    const restaurant = await prisma.restaurant.findUnique({
      where: { slug },
      select: { id: true, ownerId: true },
    });

    if (!restaurant) {
      continue;
    }

    const branch = await prisma.restaurantBranch.findFirst({
      where: { restaurantId: restaurant.id, isPrimary: true },
    });

    const menuItem = await prisma.menuItem.findFirst({
      where: { category: { restaurantId: restaurant.id } },
    });

    if (!branch || !menuItem) {
      continue;
    }

    const unitPrice = Number(menuItem.basePrice);
    const quantity = 1;
    const subtotal = unitPrice * quantity;
    const taxAmount = subtotal * TAX_RATE;
    const totalAmount = subtotal + DELIVERY_FEE + taxAmount;

    for (const [index, plan] of DEMO_ORDER_PLAN.entries()) {
      const orderNumber = `ORD-DASH-${slug.toUpperCase()}-${index}`;

      const existing = await prisma.order.findUnique({ where: { orderNumber } });

      if (existing) {
        continue;
      }

      const placedAt = todayAt(plan.hour);

      const order = await prisma.order.create({
        data: {
          customerId: customer.id,
          restaurantId: restaurant.id,
          branchId: branch.id,
          orderNumber,
          status: plan.status,
          paymentStatus:
            plan.status === OrderStatus.CANCELLED ? PaymentStatus.REFUNDED : PaymentStatus.PAID,
          paymentMode: PaymentMode.ONLINE,
          subtotalAmount: subtotal,
          deliveryFee: DELIVERY_FEE,
          taxAmount,
          totalAmount,
          deliveryAddress: '221B Baker Street, Koramangala, Bengaluru 560095',
          placedAt,
          deliveredAt: plan.status === OrderStatus.DELIVERED ? placedAt : undefined,
          items: {
            create: [{ menuItemId: menuItem.id, quantity, unitPrice, totalPrice: subtotal }],
          },
        },
      });

      const history = historyForStatus(plan.status);

      await prisma.orderStatusHistory.createMany({
        data: history.map((status, historyIndex) => ({
          orderId: order.id,
          status,
          changedById: historyIndex === 0 ? customer.id : restaurant.ownerId,
          createdAt: new Date(placedAt.getTime() + historyIndex * 5 * 60 * 1000),
        })),
      });

      orderCount++;

      const notification =
        plan.status === OrderStatus.CANCELLED
          ? {
              type: NotificationType.ORDER_CANCELLED_FOR_RESTAURANT,
              title: 'Order cancelled',
              message: `Order ${order.orderNumber} was cancelled.`,
            }
          : {
              type: NotificationType.NEW_ORDER_FOR_RESTAURANT,
              title: 'New order received',
              message: `A new order (${order.orderNumber}) was placed at your restaurant.`,
            };

      await prisma.notification.create({
        data: {
          userId: restaurant.ownerId,
          type: notification.type,
          title: notification.title,
          message: notification.message,
          channel: NotificationChannel.IN_APP,
          metadata: { referenceType: 'ORDER', referenceId: order.id },
        },
      });

      notificationCount++;
    }

    // One fresh PENDING order per flagship restaurant, placed moments ago, so the
    // order-acceptance-timeout job (RestaurantSettings.acceptanceTimeoutMinutes) has a real,
    // currently-pending order to expire in a local dev environment.
    const pendingOrderNumber = `ORD-DASH-${slug.toUpperCase()}-PENDING`;
    const pendingExisting = await prisma.order.findUnique({
      where: { orderNumber: pendingOrderNumber },
    });

    if (!pendingExisting) {
      const pendingOrder = await prisma.order.create({
        data: {
          customerId: customer.id,
          restaurantId: restaurant.id,
          branchId: branch.id,
          orderNumber: pendingOrderNumber,
          status: OrderStatus.PENDING,
          paymentStatus: PaymentStatus.PENDING,
          paymentMode: PaymentMode.ONLINE,
          subtotalAmount: subtotal,
          deliveryFee: DELIVERY_FEE,
          taxAmount,
          totalAmount,
          deliveryAddress: '221B Baker Street, Koramangala, Bengaluru 560095',
          placedAt: new Date(),
          items: {
            create: [{ menuItemId: menuItem.id, quantity, unitPrice, totalPrice: subtotal }],
          },
        },
      });

      await prisma.orderStatusHistory.create({
        data: { orderId: pendingOrder.id, status: OrderStatus.PENDING, changedById: customer.id },
      });

      await prisma.notification.create({
        data: {
          userId: restaurant.ownerId,
          type: NotificationType.NEW_ORDER_FOR_RESTAURANT,
          title: 'New order received',
          message: `A new order (${pendingOrder.orderNumber}) was placed at your restaurant.`,
          channel: NotificationChannel.IN_APP,
          metadata: { referenceType: 'ORDER', referenceId: pendingOrder.id },
        },
      });

      orderCount++;
      notificationCount++;
    }
  }

  console.log(
    `✅ ${orderCount} dashboard-demo orders and ${notificationCount} restaurant notifications seeded.`,
  );
}
