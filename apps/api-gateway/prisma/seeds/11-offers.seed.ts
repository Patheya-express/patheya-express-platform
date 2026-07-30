import { NotificationChannel, NotificationType, OfferType, PrismaClient } from '@prisma/client';

export async function seedOffers(prisma: PrismaClient): Promise<void> {
  console.log('🎉 Seeding offers...');

  // No imageUrl — no real banner artwork exists yet, and pointing at a made-up path would 404
  // in the client. The home page renders these as text-only banner cards until real images
  // are uploaded through the storage module.
  const offers = [
    {
      title: 'Flat 20% off on your first order',
      description: 'Use code WELCOME20 at checkout.',
      type: OfferType.PERCENTAGE_OFF,
      isActive: true,
    },
    {
      title: 'Free delivery this weekend',
      description: 'No minimum order value.',
      type: OfferType.FREE_DELIVERY,
      isActive: true,
    },
  ];

  let welcomeOfferId: string | undefined;

  for (const offer of offers) {
    const existing = await prisma.offer.findFirst({ where: { title: offer.title } });

    if (!existing) {
      const created = await prisma.offer.create({ data: offer });
      if (offer.title.startsWith('Flat 20%')) {
        welcomeOfferId = created.id;
      }
    } else {
      if (offer.title.startsWith('Flat 20%')) {
        welcomeOfferId = existing.id;
      }
      if (existing.type === null) {
        await prisma.offer.update({ where: { id: existing.id }, data: { type: offer.type } });
      }
    }
  }

  const restaurant = await prisma.restaurant.findUnique({
    where: { slug: 'paradise-biryani' },
  });

  if (restaurant) {
    const title = 'Buy 1 Get 1 on Biryani Bowls';
    const existing = await prisma.offer.findFirst({ where: { title } });

    if (!existing) {
      await prisma.offer.create({
        data: {
          restaurantId: restaurant.id,
          title,
          description: 'Valid on all biryani bowl variants, dine-in and delivery.',
          type: OfferType.BUY_ONE_GET_ONE,
          isActive: true,
        },
      });
    }
  }

  // A seeded OFFER-type notification with deep-link metadata, so the notification center's
  // "Offers -> Offer Details" navigation has a real row to exercise without placing an order.
  const customer = await prisma.user.findUnique({
    where: { email: 'customer@patheyaexpress.com' },
  });

  if (customer && welcomeOfferId) {
    const existingNotification = await prisma.notification.findFirst({
      where: { userId: customer.id, type: NotificationType.OFFER },
    });

    if (!existingNotification) {
      await prisma.notification.create({
        data: {
          userId: customer.id,
          type: NotificationType.OFFER,
          title: 'New offer for you',
          message: 'Flat 20% off on your first order — use code WELCOME20 at checkout.',
          channel: NotificationChannel.IN_APP,
          metadata: { referenceType: 'OFFER', referenceId: welcomeOfferId },
        },
      });
    }
  }
}
