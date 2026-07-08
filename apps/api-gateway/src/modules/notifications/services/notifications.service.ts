import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';

import {
  NotificationChannel,
  NotificationStatus,
  NotificationType,
  Notification,
} from '@prisma/client';

import { NotificationsRepository } from '../repositories/notifications.repository';
import { QueueService } from '../../../infrastructure/queues/queue.service';
import { RealtimeService } from '../../realtime/services/realtime.service';

import { GetAdminNotificationsQueryDto } from '../dto/get-admin-notifications-query.dto';
import { PaginatedAdminNotificationsResponseDto } from '../dto/paginated-admin-notifications-response.dto';
import { AdminNotificationResponseDto } from '../dto/admin-notification-response.dto';
import { GetCustomerNotificationsQueryDto } from '../dto/get-customer-notifications-query.dto';
import { PaginatedNotificationsResponseDto } from '../dto/paginated-notifications-response.dto';
import { NotificationResponseDto } from '../dto/notification-response.dto';
import { UnreadCountResponseDto } from '../dto/unread-count-response.dto';
import { MarkAllReadResponseDto } from '../dto/mark-all-read-response.dto';

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

/** Customer-facing projection — same row, no `user` relation to flatten (the caller already knows who they are). */
function toNotificationResponse(
  notification: Notification,
): NotificationResponseDto {
  return {
    id: notification.id,
    userId: notification.userId,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    channel: notification.channel,
    status: notification.status,
    metadata:
      (notification.metadata as Record<string, unknown> | null) ?? undefined,
    sentAt: notification.sentAt ?? undefined,
    readAt: notification.readAt ?? undefined,
    createdAt: notification.createdAt,
  };
}

type PushPreferenceKey =
  | 'orderUpdatesPush'
  | 'promotionsPush'
  | 'reviewsPush'
  | 'systemPush';

/** Maps each notification type to the NotificationPreference category that gates it. */
const PUSH_PREFERENCE_BY_TYPE: Record<NotificationType, PushPreferenceKey> = {
  ORDER_PLACED: 'orderUpdatesPush',
  ORDER_STATUS_CHANGED: 'orderUpdatesPush',
  DELIVERY_PARTNER_ASSIGNED: 'orderUpdatesPush',
  OFFER: 'promotionsPush',
  GENERAL: 'systemPush',
};

/**
 * Mirrors the defaults in UsersService (DEFAULT_NOTIFICATION_PREFERENCES) — applied when a user
 * has never saved a NotificationPreference row, so most users (who've never touched their
 * settings) keep receiving order/system notifications by default while promotional ones stay
 * opt-in, matching the schema's own default values.
 */
const DEFAULT_PUSH_PREFERENCE: Record<PushPreferenceKey, boolean> = {
  orderUpdatesPush: true,
  promotionsPush: false,
  reviewsPush: true,
  systemPush: true,
};

@Injectable()
export class NotificationsService {
  constructor(
    private readonly notificationsRepository: NotificationsRepository,
    private readonly queueService: QueueService,
    private readonly realtimeService: RealtimeService,
  ) {}

  /**
   * Respects the recipient's NotificationPreference before creating an IN_APP row — there is no
   * per-category "in-app" toggle in the schema (only Email/SMS/Push), so in-app creation is
   * gated on that category's Push preference, the closest conceptual match (both are immediate,
   * in-the-moment surfaces vs. Email/SMS being channels checked later). Returns null when
   * suppressed by preference; callers already treat this as fire-and-forget.
   */
  async createNotification(
    userId: string,

    type: NotificationType,

    title: string,

    message: string,

    metadata?: Record<string, unknown>,
  ): Promise<NotificationResponseDto | null> {
    const allowed = await this.isPushAllowed(userId, type);

    if (!allowed) {
      return null;
    }

    const notification = await this.notificationsRepository.createNotification({
      userId,

      type,

      title,

      message,

      metadata,

      channel: NotificationChannel.IN_APP,
    });

    this.realtimeService.emitToUser(
      userId,
      'notification',
      toNotificationResponse(notification),
    );

    return toNotificationResponse(notification);
  }

  private async isPushAllowed(
    userId: string,

    type: NotificationType,
  ): Promise<boolean> {
    const preference =
      await this.notificationsRepository.findPreference(userId);

    const key = PUSH_PREFERENCE_BY_TYPE[type];

    if (!preference) {
      return DEFAULT_PUSH_PREFERENCE[key];
    }

    return preference[key];
  }

  async getMyNotifications(
    userId: string,

    query: GetCustomerNotificationsQueryDto,
  ): Promise<PaginatedNotificationsResponseDto> {
    const skip = (query.page - 1) * query.limit;

    const { items, total } =
      await this.notificationsRepository.findCustomerNotifications({
        userId,

        skip,

        take: query.limit,

        search: query.search,

        type: query.type,

        status: query.status,

        unreadOnly: query.unreadOnly,

        dateFrom: query.dateFrom,

        dateTo: query.dateTo,
      });

    return {
      items: items.map(toNotificationResponse),

      total,

      page: query.page,

      limit: query.limit,

      totalPages: Math.ceil(total / query.limit),
    };
  }

  async getMyNotificationById(
    id: string,

    userId: string,
  ): Promise<NotificationResponseDto> {
    const notification =
      await this.notificationsRepository.findCustomerNotificationById(
        id,

        userId,
      );

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    return toNotificationResponse(notification);
  }

  async markMyNotificationAsRead(
    id: string,

    userId: string,
  ): Promise<NotificationResponseDto> {
    const updated = await this.notificationsRepository.markAsReadForCustomer(
      id,
      userId,
    );

    if (!updated) {
      throw new NotFoundException('Notification not found');
    }

    return this.getMyNotificationById(id, userId);
  }

  /** @deprecated backs the legacy, unscoped PATCH /notifications/:id/read — left as-is, not extended. */
  async markAsRead(notificationId: string) {
    return this.notificationsRepository.markAsRead(notificationId);
  }

  async markAllMyNotificationsAsRead(
    userId: string,
  ): Promise<MarkAllReadResponseDto> {
    const updatedCount =
      await this.notificationsRepository.markAllAsReadForCustomer(userId);

    return { updatedCount };
  }

  async getMyUnreadCount(userId: string): Promise<UnreadCountResponseDto> {
    const count =
      await this.notificationsRepository.countUnreadForCustomer(userId);

    return { count };
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

  async getAllForAdmin(
    query: GetAdminNotificationsQueryDto,
  ): Promise<PaginatedAdminNotificationsResponseDto> {
    const skip = (query.page - 1) * query.limit;

    const { items, total } = await this.notificationsRepository.findAllForAdmin(
      {
        search: query.search,
        type: query.type,
        channel: query.channel,
        status: query.status,
        recipient: query.recipient,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        skip,

        take: query.limit,
      },
    );

    return {
      items: items.map(toAdminNotification),

      total,

      page: query.page,

      limit: query.limit,

      totalPages: Math.ceil(total / query.limit),
    };
  }

  async getByIdForAdmin(id: string): Promise<AdminNotificationResponseDto> {
    const notification =
      await this.notificationsRepository.findByIdForAdmin(id);

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
    const notification =
      await this.notificationsRepository.findByIdForAdmin(id);

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
      const notification =
        await this.notificationsRepository.findByIdForAdmin(id);

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

        errorMessage:
          error instanceof Error ? error.message : 'Delivery attempt failed',
      });
    }
  }
}
