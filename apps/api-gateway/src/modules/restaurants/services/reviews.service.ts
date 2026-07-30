import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { NotificationType, OrderStatus } from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';
import {
  AuthenticatedUser,
  hasRestaurantRole,
} from '../../../shared/authorization/order-access.util';
import { NotificationsService } from '../../notifications/services/notifications.service';

import {
  ReviewsRepository,
  ReviewWithCustomer,
} from '../repositories/reviews.repository';
import { RestaurantsRepository } from '../repositories/restaurants.repository';
import { CreateReviewDto } from '../dto/create-review.dto';
import { GetReviewsQueryDto } from '../dto/get-reviews-query.dto';
import { GetRestaurantReviewsQueryDto } from '../dto/get-restaurant-reviews-query.dto';
import { PaginatedReviewsResponseDto } from '../dto/paginated-reviews-response.dto';
import { ReviewResponseDto } from '../dto/review-response.dto';
import { ReplyDto } from '../dto/reply-dto';
import { RatingSummaryResponseDto } from '../dto/rating-summary-response.dto';

/** Restaurant-scoped roles allowed to manage a restaurant's review replies — mirrors
 *  MENU_MANAGE_ROLES/OFFER_MANAGE_ROLES: replies are restaurant-wide, not branch-specific, so
 *  only ownership/management-level roles may post them. 'ADMIN' resolves to both platform ADMIN
 *  and SUPER_ADMIN via hasRestaurantRole/getRestaurantRole. */
const REVIEW_MANAGE_ROLES = [
  'OWNER',
  'CO_OWNER',
  'BRANCH_MANAGER',
  'ADMIN',
] as const;

const REPLY_PREVIEW_LENGTH = 120;

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
    replyText: review.replyText ?? undefined,
    replyCreatedAt: review.replyCreatedAt ?? undefined,
    replyUpdatedAt: review.replyUpdatedAt ?? undefined,
  };
}

@Injectable()
export class ReviewsService {
  constructor(
    private readonly reviewsRepository: ReviewsRepository,

    private readonly restaurantsRepository: RestaurantsRepository,

    private readonly prisma: PrismaService,

    private readonly notificationsService: NotificationsService,
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

  /** The restaurant owner's own management listing — every review, with rating/date/hasReply filters. */
  async getReviewsForManage(
    restaurantId: string,
    query: GetRestaurantReviewsQueryDto,
    user: AuthenticatedUser,
  ): Promise<PaginatedReviewsResponseDto> {
    await this.assertCanManageReviews(restaurantId, user);

    const skip = (query.page - 1) * query.limit;

    const { items, total } =
      await this.reviewsRepository.findAllForRestaurantManage(restaurantId, {
        skip,
        take: query.limit,
        rating: query.rating,
        dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
        dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
        hasReply: query.hasReply,
      });

    return {
      items: items.map(toReviewResponse),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async getRatingSummary(
    restaurantId: string,
    user: AuthenticatedUser,
  ): Promise<RatingSummaryResponseDto> {
    await this.assertCanManageReviews(restaurantId, user);

    return this.reviewsRepository.getRatingSummary(restaurantId);
  }

  async createReply(
    restaurantId: string,
    reviewId: string,
    dto: ReplyDto,
    user: AuthenticatedUser,
  ): Promise<ReviewResponseDto> {
    const review = await this.requireOwnedReview(restaurantId, reviewId, user);

    if (review.replyText) {
      throw new BadRequestException(
        'This review already has a reply — use update instead of create.',
      );
    }

    const updated = await this.reviewsRepository.setReply(
      reviewId,
      dto.replyText,
      user.userId,
      true,
    );

    await this.notificationsService.createNotification(
      review.customerId,
      NotificationType.REVIEW_REPLIED,
      'The restaurant replied to your review',
      dto.replyText.length > REPLY_PREVIEW_LENGTH
        ? `${dto.replyText.slice(0, REPLY_PREVIEW_LENGTH - 3)}...`
        : dto.replyText,
      { referenceType: 'REVIEW', referenceId: reviewId, restaurantId },
    );

    return toReviewResponse(updated);
  }

  async updateReply(
    restaurantId: string,
    reviewId: string,
    dto: ReplyDto,
    user: AuthenticatedUser,
  ): Promise<ReviewResponseDto> {
    const review = await this.requireOwnedReview(restaurantId, reviewId, user);

    if (!review.replyText) {
      throw new NotFoundException(
        'This review has no reply yet — use create instead of update.',
      );
    }

    const updated = await this.reviewsRepository.setReply(
      reviewId,
      dto.replyText,
      user.userId,
      false,
    );

    return toReviewResponse(updated);
  }

  async deleteReply(
    restaurantId: string,
    reviewId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    const review = await this.requireOwnedReview(restaurantId, reviewId, user);

    if (!review.replyText) {
      throw new NotFoundException('This review has no reply to delete.');
    }

    await this.reviewsRepository.clearReply(reviewId);
  }

  /** Resolves the review, confirms it belongs to `restaurantId`, and confirms the caller manages
   *  that restaurant — the single path every reply mutation goes through. */
  private async requireOwnedReview(
    restaurantId: string,
    reviewId: string,
    user: AuthenticatedUser,
  ): Promise<ReviewWithCustomer> {
    await this.assertCanManageReviews(restaurantId, user);

    const review = await this.reviewsRepository.findReviewById(reviewId);

    if (!review || review.restaurantId !== restaurantId) {
      throw new NotFoundException('Review not found');
    }

    return review;
  }

  private async assertCanManageReviews(
    restaurantId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    if (
      !(await hasRestaurantRole(this.prisma, restaurantId, user, [
        ...REVIEW_MANAGE_ROLES,
      ]))
    ) {
      throw new ForbiddenException(
        'You do not have permission to manage reviews for this restaurant',
      );
    }
  }
}
