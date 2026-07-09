import { Prisma } from '@prisma/client';

/**
 * The single definition of "is active right now" for an Offer — active flag plus within its
 * optional start/end window. Shared by OffersRepository (offer listings) and RestaurantsService
 * (the `offers` restaurant filter) so the two can never disagree about what counts as a live
 * offer.
 */
export function buildActiveOfferWhere(): Prisma.OfferWhereInput {
  const now = new Date();

  return {
    isActive: true,
    OR: [{ startsAt: null }, { startsAt: { lte: now } }],
    AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
  };
}
