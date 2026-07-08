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
