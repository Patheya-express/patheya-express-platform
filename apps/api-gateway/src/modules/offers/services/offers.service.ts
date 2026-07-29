import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';
import {
  AuthenticatedUser,
  hasRestaurantRole,
} from '../../../shared/authorization/order-access.util';

import {
  OffersRepository,
  OFFER_INCLUDE,
} from '../repositories/offers.repository';
import { OfferResponseDto } from '../dto/offer-response.dto';
import { GetOffersQueryDto } from '../dto/get-offers-query.dto';
import { GetRestaurantOffersQueryDto } from '../dto/get-restaurant-offers-query.dto';
import { PaginatedOffersResponseDto } from '../dto/paginated-offers-response.dto';
import { CreateOfferDto } from '../dto/create-offer.dto';
import { UpdateOfferDto } from '../dto/update-offer.dto';

const FEATURED_LIMIT = 10;
const HOME_LIMIT = 5;

/** Restaurant-scoped roles allowed to manage a restaurant's offers — mirrors MENU_MANAGE_ROLES
 *  (menu.service.ts): offers are restaurant-wide today, not branch-specific, so only
 *  ownership/management-level roles may change them. 'ADMIN' resolves to both platform ADMIN
 *  and SUPER_ADMIN via hasRestaurantRole/getRestaurantRole. */
const OFFER_MANAGE_ROLES = [
  'OWNER',
  'CO_OWNER',
  'BRANCH_MANAGER',
  'ADMIN',
] as const;

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
    isActive: offer.isActive,
    restaurantId: offer.restaurantId ?? undefined,
    restaurantName: offer.restaurant?.name ?? undefined,
    startsAt: offer.startsAt ?? undefined,
    endsAt: offer.endsAt ?? undefined,
  };
}

@Injectable()
export class OffersService {
  constructor(
    private readonly offersRepository: OffersRepository,
    private readonly prisma: PrismaService,
  ) {}

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

  /** The restaurant owner's own management listing — every offer regardless of active window. */
  async findAllForRestaurant(
    restaurantId: string,
    query: GetRestaurantOffersQueryDto,
    user: AuthenticatedUser,
  ): Promise<PaginatedOffersResponseDto> {
    await this.assertCanManageOffers(restaurantId, user);

    const skip = (query.page - 1) * query.limit;

    const { items, total } = await this.offersRepository.findAllForRestaurant(
      restaurantId,
      { skip, take: query.limit, isActive: query.isActive },
    );

    return {
      items: items.map(toOfferResponse),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async create(
    dto: CreateOfferDto,
    user: AuthenticatedUser,
  ): Promise<OfferResponseDto> {
    await this.assertCanManageOffers(dto.restaurantId, user);

    this.assertValidWindow(
      dto.startsAt ? new Date(dto.startsAt) : undefined,
      dto.endsAt ? new Date(dto.endsAt) : undefined,
    );

    const offer = await this.offersRepository.create(dto);
    return toOfferResponse(offer);
  }

  async update(
    id: string,
    dto: UpdateOfferDto,
    user: AuthenticatedUser,
  ): Promise<OfferResponseDto> {
    const existing = await this.requireOffer(id);
    await this.assertCanManageOffers(existing.restaurantId, user);

    // Cross-field validation must see the *effective* window — a request only changing endsAt
    // still has to be checked against the offer's existing startsAt, and vice versa.
    const effectiveStartsAt =
      dto.startsAt !== undefined
        ? new Date(dto.startsAt)
        : (existing.startsAt ?? undefined);
    const effectiveEndsAt =
      dto.endsAt !== undefined
        ? new Date(dto.endsAt)
        : (existing.endsAt ?? undefined);
    this.assertValidWindow(effectiveStartsAt, effectiveEndsAt);

    const offer = await this.offersRepository.update(id, dto);
    return toOfferResponse(offer);
  }

  async delete(id: string, user: AuthenticatedUser): Promise<void> {
    const existing = await this.requireOffer(id);
    await this.assertCanManageOffers(existing.restaurantId, user);

    await this.offersRepository.delete(id);
  }

  async setActive(
    id: string,
    isActive: boolean,
    user: AuthenticatedUser,
  ): Promise<OfferResponseDto> {
    const existing = await this.requireOffer(id);
    await this.assertCanManageOffers(existing.restaurantId, user);

    const offer = await this.offersRepository.setActive(id, isActive);
    return toOfferResponse(offer);
  }

  private async requireOffer(id: string) {
    const offer = await this.offersRepository.findById(id);

    if (!offer) {
      throw new NotFoundException('Offer not found');
    }

    const { restaurantId } = offer;

    if (!restaurantId) {
      // A platform-wide offer (restaurantId null) has no restaurant to authorize a caller
      // against — this sprint only implements restaurant-managed offers, so there's nothing a
      // restaurant owner (or this endpoint) should be able to do with one.
      throw new ForbiddenException(
        'This offer is not managed at the restaurant level',
      );
    }

    // Reconstructed (rather than returning `offer` directly) so the type checker carries the
    // narrowed, non-null `restaurantId` through to every caller of this method.
    return { ...offer, restaurantId };
  }

  private async assertCanManageOffers(
    restaurantId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    if (
      !(await hasRestaurantRole(this.prisma, restaurantId, user, [
        ...OFFER_MANAGE_ROLES,
      ]))
    ) {
      throw new ForbiddenException(
        'You do not have permission to manage offers for this restaurant',
      );
    }
  }

  private assertValidWindow(startsAt?: Date, endsAt?: Date): void {
    if (startsAt && endsAt && startsAt.getTime() >= endsAt.getTime()) {
      throw new BadRequestException('startsAt must be before endsAt');
    }
  }
}
