import { Injectable } from '@nestjs/common';

import { NotificationChannel, NotificationStatus, NotificationType } from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

export interface AdminNotificationFilterParams {
  search?: string;
  type?: NotificationType;
  channel?: NotificationChannel;
  status?: NotificationStatus;
  recipient?: string;
  dateFrom?: string;
  dateTo?: string;
}

@Injectable()
export class NotificationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createNotification(data: any) {
    return this.prisma.notification.create({
      data,
    });
  }

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

  private buildAdminWhere(params: AdminNotificationFilterParams): any {
    const where: any = {};

    if (params.type) {
      where.type = params.type;
    }

    if (params.channel) {
      where.channel = params.channel;
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
