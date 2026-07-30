import { OrderStatus, PaymentMode, PaymentStatus, PrismaClient } from '@prisma/client';

const DELIVERY_FEE = 40;
const TAX_RATE = 0.05;

/**
 * Realistic order history for the seeded customer, across every status that matters for the
 * customer-facing phases: DELIVERED orders (order history + review eligibility), an
 * OUT_FOR_DELIVERY order with an assigned partner (live tracking demo), and a fresh PENDING
 * order (early-stage state, no partner assigned yet).
 */
export async function seedOrders(prisma: PrismaClient): Promise<void> {
  console.log('📦 Seeding orders...');

  const customer = await prisma.user.findUnique({
    where: { email: 'customer@patheyaexpress.com' },
  });

  const deliveryPartnerUser = await prisma.user.findUnique({
    where: { email: 'rider1@patheyaexpress.com' },
  });

  if (!customer || !deliveryPartnerUser) {
    console.log('⚠️  Skipping order seed — customer or delivery partner user not found.');
    return;
  }

  const restaurant = await prisma.restaurant.findUnique({
    where: { slug: 'paradise-biryani' },
    include: { menuCategories: { include: { menuItems: true } } },
  });

  if (!restaurant) {
    console.log('⚠️  Skipping order seed — paradise-biryani restaurant not found.');
    return;
  }

  // Gives the restaurant a real branch with coordinates if it doesn't have one yet — needed
  // for realistic distance/ETA calculation in the live-tracking demo order below, and also
  // backs the restaurant-details page's operating-hours display.
  let branch = await prisma.restaurantBranch.findFirst({
    where: { restaurantId: restaurant.id },
  });

  if (!branch) {
    branch = await prisma.restaurantBranch.create({
      data: {
        restaurantId: restaurant.id,
        name: 'Paradise Biryani - Koramangala',
        addressLine1: '123 Koramangala 5th Block',
        city: 'Bengaluru',
        state: 'Karnataka',
        postalCode: '560095',
        latitude: 12.9352,
        longitude: 77.6146,
        phone: '9876500000',
      },
    });

    await prisma.operatingHour.createMany({
      data: Array.from({ length: 7 }, (_, dayOfWeek) => ({
        branchId: branch!.id,
        dayOfWeek,
        opensAt: '10:00',
        closesAt: '23:00',
        isClosed: false,
      })),
    });
  }

  const items = restaurant.menuCategories.flatMap((category) => category.menuItems);

  if (items.length === 0) {
    console.log('⚠️  Skipping order seed — no menu items found for paradise-biryani.');
    return;
  }

  const customerId = customer.id;
  const restaurantId = restaurant.id;
  const branchId = branch.id;

  const [item] = items;
  const unitPrice = Number(item.basePrice);
  const quantity = 2;
  const subtotal = unitPrice * quantity;
  const taxAmount = subtotal * TAX_RATE;
  const totalAmount = subtotal + DELIVERY_FEE + taxAmount;

  async function createSeedOrder(options: {
    orderNumber: string;
    status: OrderStatus;
    paymentStatus: PaymentStatus;
    deliveryPartnerId?: string;
    placedAt: Date;
    deliveredAt?: Date;
    historyStatuses: OrderStatus[];
  }) {
    const existing = await prisma.order.findUnique({
      where: { orderNumber: options.orderNumber },
    });

    if (existing) {
      return existing;
    }

    const order = await prisma.order.create({
      data: {
        customerId,
        restaurantId,
        branchId,
        deliveryPartnerId: options.deliveryPartnerId,
        orderNumber: options.orderNumber,
        status: options.status,
        paymentStatus: options.paymentStatus,
        paymentMode: PaymentMode.ONLINE,
        subtotalAmount: subtotal,
        deliveryFee: DELIVERY_FEE,
        taxAmount,
        totalAmount,
        deliveryAddress: '221B Baker Street, Koramangala, Bengaluru 560095',
        // A short distance from the branch's seeded coordinates, so the live-tracking ETA
        // calculation has a realistic (non-zero, non-absurd) destination to measure against.
        latitude: 12.9352 + 0.015,
        longitude: 77.6146 + 0.015,
        placedAt: options.placedAt,
        deliveredAt: options.deliveredAt,
        items: {
          create: [
            {
              menuItemId: item.id,
              quantity,
              unitPrice,
              totalPrice: subtotal,
            },
          ],
        },
      },
    });

    await prisma.orderStatusHistory.createMany({
      data: options.historyStatuses.map((status, index) => ({
        orderId: order.id,
        status,
        createdAt: new Date(options.placedAt.getTime() + index * 5 * 60 * 1000),
      })),
    });

    return order;
  }

  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;

  await createSeedOrder({
    orderNumber: 'ORD-SEED-DELIVERED-1',
    status: OrderStatus.DELIVERED,
    paymentStatus: PaymentStatus.PAID,
    deliveryPartnerId: deliveryPartnerUser.id,
    placedAt: new Date(now - 3 * DAY_MS),
    deliveredAt: new Date(now - 3 * DAY_MS + 40 * 60 * 1000),
    historyStatuses: [
      OrderStatus.PENDING,
      OrderStatus.CONFIRMED,
      OrderStatus.PREPARING,
      OrderStatus.READY_FOR_PICKUP,
      OrderStatus.OUT_FOR_DELIVERY,
      OrderStatus.DELIVERED,
    ],
  });

  await createSeedOrder({
    orderNumber: 'ORD-SEED-DELIVERED-2',
    status: OrderStatus.DELIVERED,
    paymentStatus: PaymentStatus.PAID,
    deliveryPartnerId: deliveryPartnerUser.id,
    placedAt: new Date(now - 1 * DAY_MS),
    deliveredAt: new Date(now - 1 * DAY_MS + 35 * 60 * 1000),
    historyStatuses: [
      OrderStatus.PENDING,
      OrderStatus.CONFIRMED,
      OrderStatus.PREPARING,
      OrderStatus.READY_FOR_PICKUP,
      OrderStatus.OUT_FOR_DELIVERY,
      OrderStatus.DELIVERED,
    ],
  });

  await createSeedOrder({
    orderNumber: 'ORD-SEED-OUT-FOR-DELIVERY',
    status: OrderStatus.OUT_FOR_DELIVERY,
    paymentStatus: PaymentStatus.PAID,
    deliveryPartnerId: deliveryPartnerUser.id,
    placedAt: new Date(now - 20 * 60 * 1000),
    historyStatuses: [
      OrderStatus.PENDING,
      OrderStatus.CONFIRMED,
      OrderStatus.PREPARING,
      OrderStatus.READY_FOR_PICKUP,
      OrderStatus.OUT_FOR_DELIVERY,
    ],
  });

  await createSeedOrder({
    orderNumber: 'ORD-SEED-PENDING',
    status: OrderStatus.PENDING,
    paymentStatus: PaymentStatus.PENDING,
    placedAt: new Date(now - 2 * 60 * 1000),
    historyStatuses: [OrderStatus.PENDING],
  });

  console.log('✅ 4 seed orders created (2 delivered, 1 out-for-delivery, 1 pending).');
}
