import { Injectable } from '@nestjs/common';

import { OfferType, Prisma } from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { buildActiveOfferWhere } from '../utils/offer-active-where.util';

export const OFFER_INCLUDE = {
  restaurant: { select: { name: true } },
} as const;

export interface OfferFilterParams {
  search?: string;
  restaurantId?: string;
  type?: OfferType;
}

@Injectable()
export class OffersRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Active + within its optional start/end window right now — the single definition of "valid
   * offer" every customer-facing query in this repository builds on, so a restaurant's detail
   * page and the home banners can never disagree about whether an offer is still live.
   */
  private buildActiveWhere(
    params: OfferFilterParams = {},
  ): Prisma.OfferWhereInput {
    const where: Prisma.OfferWhereInput = buildActiveOfferWhere();

    if (params.restaurantId) {
      where.restaurantId = params.restaurantId;
    }

    if (params.type) {
      where.type = params.type;
    }

    if (params.search) {
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : []),
        {
          OR: [
            { title: { contains: params.search, mode: 'insensitive' } },
            { description: { contains: params.search, mode: 'insensitive' } },
          ],
        },
      ];
    }

    return where;
  }

  /** Non-paginated, limited — powers the home banners, /offers/featured, and /offers/home. */
  async findActive(limit: number, restaurantId?: string) {
    return this.prisma.offer.findMany({
      where: this.buildActiveWhere({ restaurantId }),
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: OFFER_INCLUDE,
    });
  }

  async findAllActive(
    params: OfferFilterParams & { skip: number; take: number },
  ) {
    const where = this.buildActiveWhere(params);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.offer.findMany({
        where,
        skip: params.skip,
        take: params.take,
        orderBy: { createdAt: 'desc' },
        include: OFFER_INCLUDE,
      }),

      this.prisma.offer.count({ where }),
    ]);

    return { items, total };
  }

  async findByIdActive(id: string) {
    return this.prisma.offer.findFirst({
      where: { id, ...this.buildActiveWhere() },
      include: OFFER_INCLUDE,
    });
  }

  async findByRestaurantActive(
    restaurantId: string,

    params: { skip: number; take: number },
  ) {
    const where = this.buildActiveWhere({ restaurantId });

    const [items, total] = await this.prisma.$transaction([
      this.prisma.offer.findMany({
        where,
        skip: params.skip,
        take: params.take,
        orderBy: { createdAt: 'desc' },
        include: OFFER_INCLUDE,
      }),

      this.prisma.offer.count({ where }),
    ]);

    return { items, total };
  }
}
