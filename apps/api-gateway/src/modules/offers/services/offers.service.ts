import { Injectable, NotFoundException } from '@nestjs/common';

import { Prisma } from '@prisma/client';

import {
  OffersRepository,
  OFFER_INCLUDE,
} from '../repositories/offers.repository';
import { OfferResponseDto } from '../dto/offer-response.dto';
import { GetOffersQueryDto } from '../dto/get-offers-query.dto';
import { PaginatedOffersResponseDto } from '../dto/paginated-offers-response.dto';

const FEATURED_LIMIT = 10;
const HOME_LIMIT = 5;

type OfferWithRestaurant = Prisma.OfferGetPayload<{
  include: typeof OFFER_INCLUDE;
}>;

function toOfferResponse(offer: OfferWithRestaurant): OfferResponseDto {
  return {
    id: offer.id,
    title: offer.title,
    description: offer.description ?? undefined,
    imageUrl: offer.imageUrl ?? undefined,
    linkUrl: offer.linkUrl ?? undefined,
    type: offer.type ?? undefined,
    restaurantId: offer.restaurantId ?? undefined,
    restaurantName: offer.restaurant?.name ?? undefined,
    startsAt: offer.startsAt ?? undefined,
    endsAt: offer.endsAt ?? undefined,
  };
}

@Injectable()
export class OffersService {
  constructor(private readonly offersRepository: OffersRepository) {}

  async findAll(query: GetOffersQueryDto): Promise<PaginatedOffersResponseDto> {
    const skip = (query.page - 1) * query.limit;

    const { items, total } = await this.offersRepository.findAllActive({
      skip,
      take: query.limit,
      search: query.search,
      restaurantId: query.restaurantId,
      type: query.type,
    });

    return {
      items: items.map(toOfferResponse),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async findById(id: string): Promise<OfferResponseDto> {
    const offer = await this.offersRepository.findByIdActive(id);

    if (!offer) {
      throw new NotFoundException('Offer not found');
    }

    return toOfferResponse(offer);
  }

  async findFeatured(limit = FEATURED_LIMIT): Promise<OfferResponseDto[]> {
    const offers = await this.offersRepository.findActive(limit);
    return offers.map(toOfferResponse);
  }

  async findHome(limit = HOME_LIMIT): Promise<OfferResponseDto[]> {
    const offers = await this.offersRepository.findActive(limit);
    return offers.map(toOfferResponse);
  }

  async findByRestaurant(
    restaurantId: string,

    query: GetOffersQueryDto,
  ): Promise<PaginatedOffersResponseDto> {
    const skip = (query.page - 1) * query.limit;

    const { items, total } = await this.offersRepository.findByRestaurantActive(
      restaurantId,

      { skip, take: query.limit },
    );

    return {
      items: items.map(toOfferResponse),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  /** Used internally by RestaurantsService to embed a restaurant's active offers in its detail response. */
  async findActiveForRestaurant(
    restaurantId: string,
  ): Promise<OfferResponseDto[]> {
    const offers = await this.offersRepository.findActive(100, restaurantId);
    return offers.map(toOfferResponse);
  }
}
