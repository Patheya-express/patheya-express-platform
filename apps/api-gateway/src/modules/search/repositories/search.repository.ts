import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

const RECENT_SEARCH_LIMIT = 10;

@Injectable()
export class SearchRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Anonymous-friendly — every committed search is logged here, customerId is optional. */
  async createSearchLog(query: string, customerId?: string) {
    return this.prisma.searchLog.create({
      data: { query, customerId },
    });
  }

  /** Upsert bumps a repeated search back to the top instead of creating a duplicate row. */
  async upsertRecentSearch(customerId: string, query: string) {
    return this.prisma.recentSearch.upsert({
      where: { customerId_query: { customerId, query } },
      create: { customerId, query },
      update: { updatedAt: new Date() },
    });
  }

  async findRecentSearches(customerId: string) {
    return this.prisma.recentSearch.findMany({
      where: { customerId },
      orderBy: { updatedAt: 'desc' },
      take: RECENT_SEARCH_LIMIT,
    });
  }

  async deleteRecentSearch(id: string, customerId: string): Promise<boolean> {
    const result = await this.prisma.recentSearch.deleteMany({
      where: { id, customerId },
    });

    return result.count > 0;
  }

  async clearRecentSearches(customerId: string): Promise<number> {
    const result = await this.prisma.recentSearch.deleteMany({
      where: { customerId },
    });

    return result.count;
  }

  async findTrendingSearches(limit: number) {
    return this.prisma.trendingSearch.findMany({
      orderBy: { score: 'desc' },
      take: limit,
    });
  }

  /**
   * Aggregates SearchLog rows from the last `windowHours` into per-query counts and upserts them
   * as the new TrendingSearch scores. Read by the trending-search BullMQ job only — the public
   * endpoint always reads the precomputed TrendingSearch table, never aggregates on request.
   */
  async recomputeTrendingScores(windowHours: number): Promise<number> {
    const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

    const grouped = await this.prisma.searchLog.groupBy({
      by: ['query'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      orderBy: { _count: { query: 'desc' } },
      take: 50,
    });

    await this.prisma.$transaction(
      grouped.map((row) =>
        this.prisma.trendingSearch.upsert({
          where: { query: row.query },
          create: { query: row.query, score: row._count._all },
          update: { score: row._count._all },
        }),
      ),
    );

    // Queries that fell out of the top-50 window should stop being "trending" rather than
    // linger forever with a stale score.
    if (grouped.length > 0) {
      await this.prisma.trendingSearch.deleteMany({
        where: { query: { notIn: grouped.map((row) => row.query) } },
      });
    }

    return grouped.length;
  }
}
