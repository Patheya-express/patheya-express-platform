import { Injectable } from '@nestjs/common';

import { OfferType, Prisma } from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { buildActiveOfferWhere } from '../utils/offer-active-where.util';
import { CreateOfferDto } from '../dto/create-offer.dto';
import { UpdateOfferDto } from '../dto/update-offer.dto';

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

  /** Unrestricted lookup (no active/window filtering) — used for ownership checks and by
   *  update/delete/setActive, which must find an offer regardless of whether it's currently
   *  active, expired, or not yet started. */
  async findById(id: string) {
    return this.prisma.offer.findUnique({
      where: { id },
      include: OFFER_INCLUDE,
    });
  }

  /** Just the owning restaurantId, for authorization checks that don't need the full row. */
  async getOfferRestaurantId(id: string): Promise<string | null> {
    const offer = await this.prisma.offer.findUnique({
      where: { id },
      select: { restaurantId: true },
    });

    return offer?.restaurantId ?? null;
  }

  /** The restaurant owner's own management listing — every offer regardless of active window,
   *  optionally filtered by isActive. Distinct from findByRestaurantActive, which is the
   *  customer-facing "currently live" listing. */
  async findAllForRestaurant(
    restaurantId: string,

    params: { skip: number; take: number; isActive?: boolean },
  ) {
    const where: Prisma.OfferWhereInput = { restaurantId };

    if (params.isActive !== undefined) {
      where.isActive = params.isActive;
    }

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

  async create(dto: CreateOfferDto) {
    return this.prisma.offer.create({
      data: {
        restaurantId: dto.restaurantId,
        title: dto.title,
        description: dto.description,
        imageUrl: dto.imageUrl,
        linkUrl: dto.linkUrl,
        type: dto.type,
        isActive: dto.isActive,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined,
      },
      include: OFFER_INCLUDE,
    });
  }

  async update(id: string, dto: UpdateOfferDto) {
    return this.prisma.offer.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        imageUrl: dto.imageUrl,
        linkUrl: dto.linkUrl,
        type: dto.type,
        isActive: dto.isActive,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined,
      },
      include: OFFER_INCLUDE,
    });
  }

  async setActive(id: string, isActive: boolean) {
    return this.prisma.offer.update({
      where: { id },
      data: { isActive },
      include: OFFER_INCLUDE,
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.offer.delete({ where: { id } });
  }
}
