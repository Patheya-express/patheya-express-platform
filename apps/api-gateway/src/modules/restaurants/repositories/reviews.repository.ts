import { Injectable } from '@nestjs/common';

import { Prisma, Review } from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

export type ReviewWithCustomer = Review & {
  customer?: { firstName: string; lastName: string | null };
};

@Injectable()
export class ReviewsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One review per (restaurant, customer) — a repeat submission updates the existing review
   * rather than creating a duplicate. The restaurant's denormalized avgRating/ratingCount are
   * recomputed in the same transaction so the aggregate is never observed out of sync with
   * the review that produced it.
   */
  async upsertReview(
    restaurantId: string,

    customerId: string,

    rating: number,

    comment: string | undefined,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const review = await tx.review.upsert({
        where: {
          restaurantId_customerId: {
            restaurantId,
            customerId,
          },
        },

        update: {
          rating,
          comment,
        },

        create: {
          restaurantId,
          customerId,
          rating,
          comment,
        },
      });

      await this.recomputeAggregate(tx, restaurantId);

      return review;
    });
  }

  async deleteReview(restaurantId: string, customerId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.review.delete({
        where: {
          restaurantId_customerId: {
            restaurantId,
            customerId,
          },
        },
      });

      await this.recomputeAggregate(tx, restaurantId);
    });
  }

  async findByRestaurantAndCustomer(restaurantId: string, customerId: string) {
    return this.prisma.review.findUnique({
      where: {
        restaurantId_customerId: {
          restaurantId,
          customerId,
        },
      },
    });
  }

  /** Newest first, with the reviewing customer's display name attached. */
  async findByRestaurant(
    restaurantId: string,

    skip: number,

    take: number,
  ): Promise<{ items: ReviewWithCustomer[]; total: number }> {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.review.findMany({
        where: { restaurantId },

        include: {
          customer: {
            select: { firstName: true, lastName: true },
          },
        },

        orderBy: { createdAt: 'desc' },

        skip,

        take,
      }),

      this.prisma.review.count({ where: { restaurantId } }),
    ]);

    return { items, total };
  }

  /** Unrestricted single-review lookup (no restaurant scoping) — used for ownership checks and
   *  as the reply target; a review's owning restaurant is read off the result itself. */
  async findReviewById(id: string): Promise<ReviewWithCustomer | null> {
    return this.prisma.review.findUnique({
      where: { id },
      include: { customer: { select: { firstName: true, lastName: true } } },
    });
  }

  /** The restaurant owner's own management listing — every review regardless of reply status,
   *  with rating/date/hasReply filters the public listing doesn't support. */
  async findAllForRestaurantManage(
    restaurantId: string,

    params: {
      skip: number;
      take: number;
      rating?: number;
      dateFrom?: Date;
      dateTo?: Date;
      hasReply?: boolean;
    },
  ): Promise<{ items: ReviewWithCustomer[]; total: number }> {
    const where: Prisma.ReviewWhereInput = { restaurantId };

    if (params.rating !== undefined) {
      where.rating = params.rating;
    }

    if (params.dateFrom || params.dateTo) {
      where.createdAt = {
        ...(params.dateFrom ? { gte: params.dateFrom } : {}),
        ...(params.dateTo ? { lte: params.dateTo } : {}),
      };
    }

    if (params.hasReply !== undefined) {
      where.replyText = params.hasReply ? { not: null } : null;
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.review.findMany({
        where,

        include: {
          customer: {
            select: { firstName: true, lastName: true },
          },
        },

        orderBy: { createdAt: 'desc' },

        skip: params.skip,

        take: params.take,
      }),

      this.prisma.review.count({ where }),
    ]);

    return { items, total };
  }

  /** Average + per-star breakdown, computed live (only avgRating/ratingCount are denormalized on
   *  Restaurant, and those don't carry a per-star split). */
  async getRatingSummary(restaurantId: string): Promise<{
    averageRating: number;
    totalReviews: number;
    breakdown: { rating: number; count: number }[];
  }> {
    const [aggregate, grouped] = await this.prisma.$transaction([
      this.prisma.review.aggregate({
        where: { restaurantId },
        _avg: { rating: true },
        _count: { _all: true },
      }),

      this.prisma.review.groupBy({
        by: ['rating'],
        where: { restaurantId },
        orderBy: { rating: 'desc' },
        _count: true,
      }),
    ]);

    const counts = new Map<number, number>(
      grouped.map((row) => [row.rating, Number(row._count)]),
    );

    return {
      averageRating: aggregate._avg.rating ?? 0,
      totalReviews: aggregate._count._all,
      breakdown: [5, 4, 3, 2, 1].map((rating) => ({
        rating,
        count: counts.get(rating) ?? 0,
      })),
    };
  }

  async setReply(
    reviewId: string,
    replyText: string,
    userId: string,
    isNewReply: boolean,
  ) {
    const now = new Date();

    return this.prisma.review.update({
      where: { id: reviewId },
      data: {
        replyText,
        replyUpdatedAt: now,
        replyCreatedAt: isNewReply ? now : undefined,
        repliedByUserId: userId,
      },
      include: { customer: { select: { firstName: true, lastName: true } } },
    });
  }

  async clearReply(reviewId: string): Promise<void> {
    await this.prisma.review.update({
      where: { id: reviewId },
      data: {
        replyText: null,
        replyCreatedAt: null,
        replyUpdatedAt: null,
        repliedByUserId: null,
      },
    });
  }

  private async recomputeAggregate(
    tx: Prisma.TransactionClient,

    restaurantId: string,
  ): Promise<void> {
    const aggregate = await tx.review.aggregate({
      where: { restaurantId },
      _avg: { rating: true },
      _count: { _all: true },
    });

    await tx.restaurant.update({
      where: { id: restaurantId },
      data: {
        avgRating: aggregate._avg.rating ?? 0,
        ratingCount: aggregate._count._all,
      },
    });
  }
}
