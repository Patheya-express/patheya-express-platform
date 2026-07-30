import { Injectable } from '@nestjs/common';

import {
  NotificationChannel,
  NotificationStatus,
  NotificationType,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

export interface NotificationFilterParams {
  search?: string;
  type?: NotificationType;
  status?: NotificationStatus;
  dateFrom?: string;
  dateTo?: string;
}

export interface AdminNotificationFilterParams extends NotificationFilterParams {
  channel?: NotificationChannel;
  recipient?: string;
}

export interface CustomerNotificationFilterParams extends NotificationFilterParams {
  userId: string;
  unreadOnly?: boolean;
}

@Injectable()
export class NotificationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createNotification(data: any) {
    return this.prisma.notification.create({
      data,
    });
  }

  /** @deprecated superseded by findCustomerNotifications, kept for any other in-process caller relying on the unfiltered list. */
  async findUserNotifications(userId: string) {
    return this.prisma.notification.findMany({
      where: {
        userId,
      },

      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async markAsRead(notificationId: string) {
    return this.prisma.notification.update({
      where: {
        id: notificationId,
      },

      data: {
        status: 'READ',

        readAt: new Date(),
      },
    });
  }

  async savePushToken(data: any) {
    return this.prisma.pushToken.upsert({
      where: {
        token: data.token,
      },

      update: {
        platform: data.platform,
      },

      create: data,
    });
  }

  async findPreference(userId: string) {
    return this.prisma.notificationPreference.findUnique({
      where: { userId },
    });
  }

  /**
   * Shared by both the admin and customer filter builders — search/type/status/date-range are
   * identical for both audiences; only the admin-only (channel/recipient) and customer-only
   * (userId) clauses differ, added by their respective callers below.
   */
  private buildBaseWhere(
    params: NotificationFilterParams,
  ): Prisma.NotificationWhereInput {
    const where: Prisma.NotificationWhereInput = {};

    if (params.type) {
      where.type = params.type;
    }

    if (params.status) {
      where.status = params.status;
    }

    if (params.dateFrom || params.dateTo) {
      where.createdAt = {
        ...(params.dateFrom ? { gte: new Date(params.dateFrom) } : {}),

        ...(params.dateTo ? { lte: new Date(params.dateTo) } : {}),
      };
    }

    if (params.search) {
      where.OR = [
        { title: { contains: params.search, mode: 'insensitive' } },
        { message: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    return where;
  }

  private buildAdminWhere(
    params: AdminNotificationFilterParams,
  ): Prisma.NotificationWhereInput {
    const where = this.buildBaseWhere(params);

    if (params.channel) {
      where.channel = params.channel;
    }

    if (params.recipient) {
      where.user = {
        OR: [
          { firstName: { contains: params.recipient, mode: 'insensitive' } },
          { lastName: { contains: params.recipient, mode: 'insensitive' } },
          { email: { contains: params.recipient, mode: 'insensitive' } },
          { phone: { contains: params.recipient, mode: 'insensitive' } },
        ],
      };
    }

    return where;
  }

  private buildCustomerWhere(
    params: CustomerNotificationFilterParams,
  ): Prisma.NotificationWhereInput {
    return {
      ...this.buildBaseWhere(params),
      userId: params.userId,
      ...(params.unreadOnly
        ? { status: { not: NotificationStatus.READ } }
        : {}),
    };
  }

  /**
   * Platform-wide, filterable notification listing for admin use. Joins through to the
   * recipient (User) for search/display — the service layer maps this down to
   * AdminNotificationRecipientSummaryDto so the raw row (and its passwordHash) never leaves
   * this layer, mirroring AuditRepository.findAllForAdmin.
   */
  async findAllForAdmin(
    params: AdminNotificationFilterParams & { skip: number; take: number },
  ): Promise<{ items: any[]; total: number }> {
    const where = this.buildAdminWhere(params);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
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

      this.prisma.notification.count({
        where,
      }),
    ]);

    return { items, total };
  }

  async findByIdForAdmin(id: string) {
    return this.prisma.notification.findUnique({
      where: {
        id,
      },

      include: {
        user: true,
      },
    });
  }

  /** Self-service equivalent of findAllForAdmin — same filter shape, scoped to one user, no recipient join needed. */
  async findCustomerNotifications(
    params: CustomerNotificationFilterParams & { skip: number; take: number },
  ) {
    const where = this.buildCustomerWhere(params);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,

        skip: params.skip,

        take: params.take,

        orderBy: {
          createdAt: 'desc',
        },
      }),

      this.prisma.notification.count({
        where,
      }),
    ]);

    return { items, total };
  }

  async findCustomerNotificationById(id: string, userId: string) {
    return this.prisma.notification.findFirst({
      where: { id, userId },
    });
  }

  /** Returns false (rather than throwing) when the id doesn't belong to userId — the service layer decides how to respond. */
  async markAsReadForCustomer(id: string, userId: string): Promise<boolean> {
    const result = await this.prisma.notification.updateMany({
      where: { id, userId },

      data: {
        status: NotificationStatus.READ,
        readAt: new Date(),
      },
    });

    return result.count > 0;
  }

  async markAllAsReadForCustomer(userId: string): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, status: { not: NotificationStatus.READ } },

      data: {
        status: NotificationStatus.READ,
        readAt: new Date(),
      },
    });

    return result.count;
  }

  async countUnreadForCustomer(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, status: { not: NotificationStatus.READ } },
    });
  }

  async recordDeliveryAttempt(
    id: string,

    data: {
      status: NotificationStatus;
      errorMessage?: string | null;
      sentAt?: Date | null;
    },
  ) {
    return this.prisma.notification.update({
      where: {
        id,
      },

      data: {
        status: data.status,
        errorMessage: data.errorMessage ?? null,
        sentAt: data.sentAt,
        attempts: {
          increment: 1,
        },
      },

      include: {
        user: true,
      },
    });
  }
}
