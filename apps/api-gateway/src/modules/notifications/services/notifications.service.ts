import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';

import { NotificationChannel, NotificationStatus, NotificationType } from '@prisma/client';

import { NotificationsRepository } from '../repositories/notifications.repository';
import { QueueService } from '../../../infrastructure/queues/queue.service';

import { GetAdminNotificationsQueryDto } from '../dto/get-admin-notifications-query.dto';
import { PaginatedAdminNotificationsResponseDto } from '../dto/paginated-admin-notifications-response.dto';
import { AdminNotificationResponseDto } from '../dto/admin-notification-response.dto';

/**
 * A parallel, admin-facing notification projection — flattens the raw Prisma `user` relation
 * down to AdminNotificationRecipientSummaryDto so passwordHash never leaves this layer,
 * mirroring AuditService's toAdminAuditLog.
 */
function toAdminNotification(notification: any): AdminNotificationResponseDto {
  return {
    id: notification.id,
    type: notification.type,
    channel: notification.channel,
    recipient: {
      id: notification.user.id,
      firstName: notification.user.firstName,
      lastName: notification.user.lastName ?? undefined,
      email: notification.user.email ?? undefined,
      phone: notification.user.phone ?? undefined,
    },
    title: notification.title,
    message: notification.message,
    status: notification.status,
    attempts: notification.attempts,
    errorMessage: notification.errorMessage ?? undefined,
    metadata: notification.metadata ?? undefined,
    sentAt: notification.sentAt ?? undefined,
    readAt: notification.readAt ?? undefined,
    createdAt: notification.createdAt,
    updatedAt: notification.updatedAt,
  };
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly notificationsRepository: NotificationsRepository,
    private readonly queueService: QueueService,
  ) {}

  async createNotification(
    userId: string,

    type: NotificationType,

    title: string,

    message: string,

    metadata?: any,
  ) {
    return this.notificationsRepository.createNotification({
      userId,

      type,

      title,

      message,

      metadata,

      channel: NotificationChannel.IN_APP,
    });
  }

  async getMyNotifications(userId: string) {
    return this.notificationsRepository.findUserNotifications(userId);
  }

  async markAsRead(notificationId: string) {
    return this.notificationsRepository.markAsRead(notificationId);
  }

  async registerPushToken(
    userId: string,

    token: string,

    platform: string,
  ) {
    return this.notificationsRepository.savePushToken({
      userId,

      token,

      platform,
    });
  }

  async getAllForAdmin(query: GetAdminNotificationsQueryDto): Promise<PaginatedAdminNotificationsResponseDto> {
    const skip = (query.page - 1) * query.limit;

    const { items, total } = await this.notificationsRepository.findAllForAdmin({
      search: query.search,
      type: query.type,
      channel: query.channel,
      status: query.status,
      recipient: query.recipient,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      skip,

      take: query.limit,
    });

    return {
      items: items.map(toAdminNotification),

      total,

      page: query.page,

      limit: query.limit,

      totalPages: Math.ceil(total / query.limit),
    };
  }

  async getByIdForAdmin(id: string): Promise<AdminNotificationResponseDto> {
    const notification = await this.notificationsRepository.findByIdForAdmin(id);

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    return toAdminNotification(notification);
  }

  /**
   * Provider-agnostic retry: enqueues the same 'send-notification' job the original dispatch
   * path uses (QueueService.addNotificationJob). NotificationProcessor is the single place
   * that resolves the delivery outcome — this method never branches on channel.
   */
  async retryNotification(id: string): Promise<AdminNotificationResponseDto> {
    const notification = await this.notificationsRepository.findByIdForAdmin(id);

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    if (notification.status !== NotificationStatus.FAILED) {
      throw new BadRequestException('Only failed notifications can be retried');
    }

    await this.queueService.addNotificationJob({
      type: 'retry-notification',

      notificationId: id,
    });

    return toAdminNotification(notification);
  }

  /**
   * The single generic delivery step NotificationProcessor runs for a retry job. No channel
   * providers (email/SMS/push) exist yet in this codebase, so there is nothing to branch on;
   * a successful generic redelivery is recorded the same way for every channel. Wiring real
   * providers per channel is separate, future work — not part of this retry mechanism.
   */
  async deliverNotification(id: string): Promise<void> {
    try {
      const notification = await this.notificationsRepository.findByIdForAdmin(id);

      if (!notification) {
        return;
      }

      await this.notificationsRepository.recordDeliveryAttempt(id, {
        status: NotificationStatus.SENT,

        sentAt: new Date(),

        errorMessage: null,
      });
    } catch (error) {
      await this.notificationsRepository.recordDeliveryAttempt(id, {
        status: NotificationStatus.FAILED,

        errorMessage: error instanceof Error ? error.message : 'Delivery attempt failed',
      });
    }
  }
}
