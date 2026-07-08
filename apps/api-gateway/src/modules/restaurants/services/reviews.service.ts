import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { OrderStatus } from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import {
  ReviewsRepository,
  ReviewWithCustomer,
} from '../repositories/reviews.repository';
import { RestaurantsRepository } from '../repositories/restaurants.repository';
import { CreateReviewDto } from '../dto/create-review.dto';
import { GetReviewsQueryDto } from '../dto/get-reviews-query.dto';
import { PaginatedReviewsResponseDto } from '../dto/paginated-reviews-response.dto';
import { ReviewResponseDto } from '../dto/review-response.dto';

function toReviewResponse(review: ReviewWithCustomer): ReviewResponseDto {
  const customer = review.customer;

  return {
    id: review.id,
    restaurantId: review.restaurantId,
    customerId: review.customerId,
    customerName: customer
      ? `${customer.firstName} ${customer.lastName ?? ''}`.trim()
      : undefined,
    rating: review.rating,
    comment: review.comment ?? undefined,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
  };
}

@Injectable()
export class ReviewsService {
  constructor(
    private readonly reviewsRepository: ReviewsRepository,

    private readonly restaurantsRepository: RestaurantsRepository,

    private readonly prisma: PrismaService,
  ) {}

  async createReview(
    restaurantId: string,
    customerId: string,
    dto: CreateReviewDto,
  ) {
    const restaurant =
      await this.restaurantsRepository.findRestaurantById(restaurantId);

    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }

    const hasDeliveredOrder = await this.prisma.order.findFirst({
      where: {
        restaurantId,
        customerId,
        status: OrderStatus.DELIVERED,
      },

      select: { id: true },
    });

    if (!hasDeliveredOrder) {
      throw new ForbiddenException(
        'You can only review a restaurant after a delivered order from it',
      );
    }

    const review = await this.reviewsRepository.upsertReview(
      restaurantId,
      customerId,
      dto.rating,
      dto.comment,
    );

    return toReviewResponse(review);
  }

  async getReviews(
    restaurantId: string,
    query: GetReviewsQueryDto,
  ): Promise<PaginatedReviewsResponseDto> {
    const restaurant =
      await this.restaurantsRepository.findRestaurantById(restaurantId);

    if (!restaurant) {
      throw new NotFoundException('Restaurant not found');
    }

    const skip = (query.page - 1) * query.limit;

    const { items, total } = await this.reviewsRepository.findByRestaurant(
      restaurantId,
      skip,
      query.limit,
    );

    return {
      items: items.map(toReviewResponse),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async getMyReview(restaurantId: string, customerId: string) {
    const review = await this.reviewsRepository.findByRestaurantAndCustomer(
      restaurantId,
      customerId,
    );

    return review ? toReviewResponse(review) : null;
  }

  async deleteReview(restaurantId: string, customerId: string) {
    const existing = await this.reviewsRepository.findByRestaurantAndCustomer(
      restaurantId,
      customerId,
    );

    if (!existing) {
      throw new NotFoundException('Review not found');
    }

    await this.reviewsRepository.deleteReview(restaurantId, customerId);

    return { success: true };
  }
}
