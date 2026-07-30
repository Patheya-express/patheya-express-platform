import { Injectable } from '@nestjs/common';

import { AuditAction } from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

export interface AdminAuditFilterParams {
  search?: string;
  action?: AuditAction;
  entityType?: string;
  userId?: string;
  dateFrom?: string;
  dateTo?: string;
}

@Injectable()
export class AuditRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createLog(data: any) {
    return this.prisma.auditLog.create({
      data,
    });
  }

  async findLogs(
    page: number,

    limit: number,
  ) {
    return this.prisma.auditLog.findMany({
      skip: (page - 1) * limit,

      take: limit,

      orderBy: {
        createdAt: 'desc',
      },

      include: {
        user: true,
      },
    });
  }

  private buildAdminWhere(params: AdminAuditFilterParams): any {
    const where: any = {};

    if (params.action) {
      where.action = params.action;
    }

    if (params.entityType) {
      where.entityType = params.entityType;
    }

    if (params.userId) {
      where.userId = params.userId;
    }

    if (params.dateFrom || params.dateTo) {
      where.createdAt = {
        ...(params.dateFrom ? { gte: new Date(params.dateFrom) } : {}),

        ...(params.dateTo ? { lte: new Date(params.dateTo) } : {}),
      };
    }

    if (params.search) {
      where.OR = [
        { entityType: { contains: params.search, mode: 'insensitive' } },
        { entityId: { contains: params.search, mode: 'insensitive' } },
        {
          user: { firstName: { contains: params.search, mode: 'insensitive' } },
        },
        {
          user: { lastName: { contains: params.search, mode: 'insensitive' } },
        },
        { user: { email: { contains: params.search, mode: 'insensitive' } } },
      ];
    }

    return where;
  }

  /**
   * Platform-wide, filterable audit log listing for admin use. Joins through to the actor
   * (User) for search/display — the service layer maps this down to AdminAuditActorSummaryDto
   * so the raw row (and its passwordHash) never leaves this layer.
   */
  async findAllForAdmin(
    params: AdminAuditFilterParams & { skip: number; take: number },
  ): Promise<{ items: any[]; total: number }> {
    const where = this.buildAdminWhere(params);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,

        skip: params.skip,

        take: params.take,

        orderBy: {
          createdAt: 'desc',
        },

        include: {
          user: true,
        },
      }),

      this.prisma.auditLog.count({
        where,
      }),
    ]);

    return { items, total };
  }
}
