import {
  Inject,
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
import {
  PUSH_DISPATCHER,
  type PushDispatcher,
  type PushMessage,
  type PushSendResult,
} from '../push/push-provider';
import { MetricsService } from '../../metrics/metrics.service';
import { AppLoggerService } from '../../../infrastructure/logger/logger.service';

/** Metadata keys that steer delivery and must not be sent to the device as data. */
const PUSH_CONTROL_KEYS = new Set(['dedupeKey', 'androidChannelId']);

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
  REFUND_ISSUED: 'orderUpdatesPush',
  OFFER: 'promotionsPush',
  WALLET_CREDIT: 'systemPush',
  REFERRAL_REWARD: 'systemPush',
  TICKET_STATUS_CHANGED: 'systemPush',
  TICKET_MESSAGE: 'systemPush',
  REVIEW_REPLIED: 'reviewsPush',
  GENERAL: 'systemPush',
  // Restaurant-facing types are gated by RestaurantSettings notification preferences
  // (see getRestaurantNotificationPreferences), not by this customer-facing preference map —
  // still mapped here so PUSH_PREFERENCE_BY_TYPE stays exhaustive over NotificationType.
  NEW_ORDER_FOR_RESTAURANT: 'orderUpdatesPush',
  ORDER_CANCELLED_FOR_RESTAURANT: 'orderUpdatesPush',
  REFUND_FOR_RESTAURANT: 'orderUpdatesPush',
  CUSTOMER_MESSAGE_FOR_RESTAURANT: 'systemPush',
  // Delivery-partner-facing types (EDPH-1) — same rationale as the restaurant-facing block
  // above: gated by the partner's own settings elsewhere, mapped here only so this stays
  // exhaustive over NotificationType.
  DELIVERY_PARTNER_VERIFICATION_SUBMITTED: 'systemPush',
  DELIVERY_PARTNER_VERIFICATION_APPROVED: 'systemPush',
  DELIVERY_PARTNER_VERIFICATION_REJECTED: 'systemPush',
  DELIVERY_PARTNER_CHANGES_REQUESTED: 'systemPush',
  DELIVERY_PARTNER_DOCUMENT_EXPIRING: 'systemPush',
  // Delivery Proof & Trust (Sprint 4.1) — pickup/delivery OTP events are order-lifecycle
  // notifications, gated the same way ORDER_STATUS_CHANGED already is.
  PICKUP_OTP_GENERATED: 'orderUpdatesPush',
  DELIVERY_OTP_GENERATED: 'orderUpdatesPush',
  PICKUP_VERIFIED: 'orderUpdatesPush',
  DELIVERY_VERIFIED: 'orderUpdatesPush',
  // Delivery Proof & Trust extension — retained in the enum but no longer triggered anywhere
  // (see its schema.prisma doc comment); still mapped so this Record stays exhaustive.
  PARCEL_CONFIRMED: 'orderUpdatesPush',
  // 2026-09-16 business-workflow revision — sent to the customer on rider arrival; same
  // order-lifecycle category as the OTP/verification events above.
  RIDER_ARRIVED_AT_RESTAURANT: 'orderUpdatesPush',
  // 2026-10-12 — delivery-partner assignment offer push; operational order traffic, same
  // category (and default-on) as the other order-lifecycle notifications.
  DELIVERY_ASSIGNMENT_OFFERED: 'orderUpdatesPush',
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
    @Inject(PUSH_DISPATCHER)
    private readonly pushDispatcher: PushDispatcher,
    private readonly metrics: MetricsService,
    private readonly logger: AppLoggerService,
  ) {}

  /**
   * Queues one logical PUSH notification. Idempotent per `dedupeKey`: a repeated trigger for the
   * same logical event (a redelivered event, a retried job) finds the existing row and does not
   * queue a second send — the BullMQ jobId is the same key, so even a concurrent duplicate add is
   * collapsed by the queue. The row starts PENDING; only deliverPushNotification records the
   * outcome. Respects the recipient's push preference like createNotification.
   */
  async queuePushNotification(params: {
    userId: string;
    type: NotificationType;
    message: PushMessage;
    dedupeKey: string;
  }): Promise<Notification | null> {
    const { userId, type, message, dedupeKey } = params;

    if (!(await this.isPushAllowed(userId, type))) {
      return null;
    }

    const existing =
      await this.notificationsRepository.findNotificationByDedupeKey(
        userId,
        dedupeKey,
      );

    if (existing) {
      return existing;
    }

    const notification = await this.notificationsRepository.createNotification({
      userId,
      type,
      title: message.title,
      message: message.body,
      channel: NotificationChannel.PUSH,
      metadata: {
        ...message.data,
        dedupeKey,
        ...(message.androidChannelId
          ? { androidChannelId: message.androidChannelId }
          : {}),
      },
    });

    await this.queueService.addNotificationJob(
      { type: 'send-push', notificationId: notification.id },
      { jobId: `push-${dedupeKey}` },
    );

    return notification;
  }

  /**
   * Sends a queued PUSH notification to every device registered for its user and records the
   * outcome on the row. SENT means a provider *accepted* the message for at least one device —
   * it is never recorded when nothing was handed to a provider. Permanently invalid tokens are
   * deleted. A transient provider failure with no device accepted throws, so the BullMQ job's
   * retry/backoff applies.
   */
  async deliverPushNotification(id: string): Promise<void> {
    const notification =
      await this.notificationsRepository.findNotificationById(id);

    if (
      !notification ||
      notification.channel !== NotificationChannel.PUSH ||
      notification.status === NotificationStatus.SENT ||
      notification.status === NotificationStatus.READ
    ) {
      return;
    }

    if (!this.pushDispatcher.isConfigured()) {
      await this.recordPushOutcome(id, notification.type, {
        status: NotificationStatus.FAILED,
        errorMessage: 'Push provider not configured',
      });
      return;
    }

    const targets = await this.notificationsRepository.findPushTokensForUser(
      notification.userId,
    );

    if (targets.length === 0) {
      await this.recordPushOutcome(id, notification.type, {
        status: NotificationStatus.FAILED,
        errorMessage: 'No registered device for this user',
      });
      return;
    }

    const metadata = (notification.metadata ?? {}) as Record<string, unknown>;
    const data = Object.fromEntries(
      Object.entries(metadata)
        .filter(([key]) => !PUSH_CONTROL_KEYS.has(key))
        .map(([key, value]) => [key, String(value)]),
    );
    const androidChannelId =
      typeof metadata['androidChannelId'] === 'string'
        ? metadata['androidChannelId']
        : undefined;

    let results: PushSendResult[];
    try {
      results = await this.pushDispatcher.send(targets, {
        title: notification.title,
        body: notification.message,
        data,
        androidChannelId,
      });
    } catch (error) {
      await this.recordPushOutcome(id, notification.type, {
        status: NotificationStatus.FAILED,
        errorMessage:
          error instanceof Error ? error.message : 'Push provider error',
      });
      throw error;
    }

    const platformByToken = new Map(
      targets.map((target) => [target.token, target.platform]),
    );
    for (const result of results) {
      this.metrics.recordPushDeliveryOutcome(
        platformByToken.get(result.token) ?? 'unknown',
        result.outcome,
      );
    }

    const invalidTokens = results
      .filter((result) => result.outcome === 'invalid-token')
      .map((result) => result.token);

    if (invalidTokens.length > 0) {
      await this.notificationsRepository.deletePushTokens(invalidTokens);
    }

    const counts = {
      accepted: results.filter((r) => r.outcome === 'accepted').length,
      invalid: invalidTokens.length,
      failed: results.filter((r) => r.outcome === 'failed').length,
      skipped: results.filter((r) => r.outcome === 'skipped').length,
    };

    if (counts.accepted > 0) {
      await this.recordPushOutcome(
        id,
        notification.type,
        {
          status: NotificationStatus.SENT,
          sentAt: new Date(),
          errorMessage: null,
        },
        counts,
      );
      return;
    }

    const transient = results.find((result) => result.outcome === 'failed');

    await this.recordPushOutcome(
      id,
      notification.type,
      {
        status: NotificationStatus.FAILED,
        errorMessage: transient
          ? (transient.error ?? 'Push delivery failed')
          : counts.skipped > 0
            ? 'No push provider configured for the registered devices'
            : 'All registered device tokens were invalid',
      },
      counts,
    );

    if (transient) {
      throw new Error(transient.error ?? 'Push delivery failed');
    }
  }

  /** Persists a push attempt's outcome and logs it (ids and counts only — never tokens). */
  private async recordPushOutcome(
    id: string,
    type: NotificationType,
    outcome: {
      status: NotificationStatus;
      errorMessage?: string | null;
      sentAt?: Date | null;
    },
    counts?: Record<string, number>,
  ): Promise<void> {
    await this.notificationsRepository.recordDeliveryAttempt(id, outcome);

    this.logger.log(
      {
        event: 'push_delivery_attempt',
        notificationId: id,
        notificationType: type,
        status: outcome.status,
        reason: outcome.errorMessage ?? undefined,
        ...counts,
      },
      'NotificationsService',
    );
  }

  /** Removes the caller's own device token (logout). Other users' tokens are never touched. */
  async unregisterPushToken(userId: string, token: string): Promise<void> {
    await this.notificationsRepository.deletePushTokenForUser(userId, token);
  }

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
   * The delivery step NotificationProcessor runs for an admin retry job. 2026-10-12: this used to
   * record SENT for every channel without sending anything (no email/SMS/push providers exist),
   * so a "retried" notification looked delivered when nothing had happened. Now:
   *  - PUSH goes through deliverPushNotification (real provider seam; FAILED while unconfigured);
   *  - IN_APP is re-emitted over the realtime socket — the in-app channel's actual delivery path;
   *  - EMAIL/SMS/WHATSAPP have no provider, so the attempt is recorded as FAILED, not SENT.
   */
  async deliverNotification(id: string): Promise<void> {
    try {
      const notification =
        await this.notificationsRepository.findByIdForAdmin(id);

      if (!notification) {
        return;
      }

      if (notification.channel === NotificationChannel.PUSH) {
        await this.deliverPushNotification(id);
        return;
      }

      if (notification.channel !== NotificationChannel.IN_APP) {
        await this.notificationsRepository.recordDeliveryAttempt(id, {
          status: NotificationStatus.FAILED,
          errorMessage: `No ${notification.channel} provider is configured`,
        });
        return;
      }

      this.realtimeService.emitToUser(
        notification.userId,
        'notification',
        toNotificationResponse(notification),
      );

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
