import {
  NotificationChannel,
  NotificationStatus,
  NotificationType,
} from '@prisma/client';

import { NotificationsService } from './notifications.service';
import type { NotificationsRepository } from '../repositories/notifications.repository';
import type { QueueService } from '../../../infrastructure/queues/queue.service';
import type { RealtimeService } from '../../realtime/services/realtime.service';
import type { EventBusService } from '../../../core/events/event-bus.service';
import { DeliveryAssignmentPushListener } from '../listeners/delivery-assignment-push.listener';
import type { PushDispatcher } from '../push/push-provider';
import { UnconfiguredPushProvider } from '../push/push-provider';
import { PlatformPushDispatcher } from '../push/platform-push-dispatcher';
import type { MetricsService } from '../../metrics/metrics.service';
import type { AppLoggerService } from '../../../infrastructure/logger/logger.service';

/**
 * 2026-10-12 — background/closed-app push path for delivery-assignment offers. Covers the
 * guarantees the Phase 2 requirements set: one logical notification per assignment, outcomes
 * recorded honestly (never SENT unless a provider accepted it), invalid tokens cleaned up,
 * transient failures retried, and no customer data in the payload.
 */
describe('NotificationsService — push delivery', () => {
  let repository: {
    findPreference: jest.Mock;
    findNotificationByDedupeKey: jest.Mock;
    createNotification: jest.Mock;
    findNotificationById: jest.Mock;
    findByIdForAdmin: jest.Mock;
    findPushTokensForUser: jest.Mock;
    deletePushTokens: jest.Mock;
    deletePushTokenForUser: jest.Mock;
    recordDeliveryAttempt: jest.Mock;
  };
  let metrics: { recordPushDeliveryOutcome: jest.Mock };
  let logger: { log: jest.Mock };
  let queueService: { addNotificationJob: jest.Mock };
  let realtimeService: { emitToUser: jest.Mock };
  let send: jest.Mock;
  let dispatcher: PushDispatcher;
  let service: NotificationsService;

  function buildService(pushDispatcher: PushDispatcher): NotificationsService {
    return new NotificationsService(
      repository as unknown as NotificationsRepository,
      queueService as unknown as QueueService,
      realtimeService as unknown as RealtimeService,
      pushDispatcher,
      metrics as unknown as MetricsService,
      logger as unknown as AppLoggerService,
    );
  }

  const PUSH_ROW = {
    id: 'notification-1',
    userId: 'rider-1',
    type: NotificationType.DELIVERY_ASSIGNMENT_OFFERED,
    title: 'New delivery assigned',
    message: 'You have a new delivery offer.',
    channel: NotificationChannel.PUSH,
    status: NotificationStatus.PENDING,
    metadata: {
      type: 'delivery.assignment',
      assignmentId: 'assignment-1',
      orderId: 'order-1',
      dedupeKey: 'delivery-assignment-offered:assignment-1',
    },
  };

  beforeEach(() => {
    repository = {
      findPreference: jest.fn().mockResolvedValue(null),
      findNotificationByDedupeKey: jest.fn().mockResolvedValue(null),
      createNotification: jest.fn().mockResolvedValue(PUSH_ROW),
      findNotificationById: jest.fn().mockResolvedValue(PUSH_ROW),
      findByIdForAdmin: jest.fn(),
      findPushTokensForUser: jest.fn().mockResolvedValue([
        { token: 'token-a', platform: 'android' },
        { token: 'token-b', platform: 'ios' },
      ]),
      deletePushTokens: jest.fn().mockResolvedValue({ count: 1 }),
      deletePushTokenForUser: jest.fn().mockResolvedValue({ count: 1 }),
      recordDeliveryAttempt: jest.fn().mockResolvedValue(undefined),
    };
    queueService = {
      addNotificationJob: jest.fn().mockResolvedValue(undefined),
    };
    realtimeService = { emitToUser: jest.fn() };
    metrics = { recordPushDeliveryOutcome: jest.fn() };
    logger = { log: jest.fn() };
    send = jest.fn();
    dispatcher = {
      isConfigured: () => true,
      send,
    };

    service = buildService(dispatcher);
  });

  describe('queuePushNotification', () => {
    const request = {
      userId: 'rider-1',
      type: NotificationType.DELIVERY_ASSIGNMENT_OFFERED,
      dedupeKey: 'delivery-assignment-offered:assignment-1',
      message: {
        title: 'New delivery assigned',
        body: 'You have a new delivery offer.',
        data: { assignmentId: 'assignment-1' },
      },
    };

    it('creates one PENDING PUSH row and queues an idempotent send job', async () => {
      await service.queuePushNotification(request);

      expect(repository.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'rider-1',
          channel: NotificationChannel.PUSH,
          metadata: {
            assignmentId: 'assignment-1',
            dedupeKey: 'delivery-assignment-offered:assignment-1',
          },
        }),
      );
      expect(queueService.addNotificationJob).toHaveBeenCalledWith(
        { type: 'send-push', notificationId: 'notification-1' },
        { jobId: 'push-delivery-assignment-offered:assignment-1' },
      );
    });

    it('does not create or queue a second notification for the same logical event', async () => {
      repository.findNotificationByDedupeKey.mockResolvedValue(PUSH_ROW);

      const result = await service.queuePushNotification(request);

      expect(result).toBe(PUSH_ROW);
      expect(repository.createNotification).not.toHaveBeenCalled();
      expect(queueService.addNotificationJob).not.toHaveBeenCalled();
    });

    it('respects a recipient who turned order-update pushes off', async () => {
      repository.findPreference.mockResolvedValue({ orderUpdatesPush: false });

      expect(await service.queuePushNotification(request)).toBeNull();
      expect(queueService.addNotificationJob).not.toHaveBeenCalled();
    });
  });

  describe('deliverPushNotification', () => {
    it('records FAILED — never SENT — while no provider is configured', async () => {
      service = buildService(
        new PlatformPushDispatcher({
          android: new UnconfiguredPushProvider(),
          ios: new UnconfiguredPushProvider(),
        }),
      );

      await service.deliverPushNotification('notification-1');

      expect(repository.recordDeliveryAttempt).toHaveBeenCalledWith(
        'notification-1',
        {
          status: NotificationStatus.FAILED,
          errorMessage: 'Push provider not configured',
        },
      );
      expect(repository.findPushTokensForUser).not.toHaveBeenCalled();
    });

    it('records FAILED when the user has no registered device', async () => {
      repository.findPushTokensForUser.mockResolvedValue([]);

      await service.deliverPushNotification('notification-1');

      expect(send).not.toHaveBeenCalled();
      expect(repository.recordDeliveryAttempt).toHaveBeenCalledWith(
        'notification-1',
        expect.objectContaining({ status: NotificationStatus.FAILED }),
      );
    });

    it('sends ids-only string data (no dedupe key) and records SENT once accepted', async () => {
      send.mockResolvedValue([
        { token: 'token-a', outcome: 'accepted' },
        { token: 'token-b', outcome: 'accepted' },
      ]);

      await service.deliverPushNotification('notification-1');

      expect(send).toHaveBeenCalledWith(
        [
          { token: 'token-a', platform: 'android' },
          { token: 'token-b', platform: 'ios' },
        ],
        {
          title: 'New delivery assigned',
          body: 'You have a new delivery offer.',
          data: {
            type: 'delivery.assignment',
            assignmentId: 'assignment-1',
            orderId: 'order-1',
          },
          androidChannelId: undefined,
        },
      );
      expect(metrics.recordPushDeliveryOutcome).toHaveBeenCalledWith(
        'android',
        'accepted',
      );
      expect(metrics.recordPushDeliveryOutcome).toHaveBeenCalledWith(
        'ios',
        'accepted',
      );
      const [logEntry] = logger.log.mock.calls[0] as [Record<string, unknown>];
      expect(logEntry).toMatchObject({
        event: 'push_delivery_attempt',
        notificationId: 'notification-1',
        status: NotificationStatus.SENT,
        accepted: 2,
      });
      expect(JSON.stringify(logEntry)).not.toContain('token-a');
      expect(repository.recordDeliveryAttempt).toHaveBeenCalledWith(
        'notification-1',
        expect.objectContaining({ status: NotificationStatus.SENT }),
      );
    });

    it('deletes tokens the provider reports as invalid', async () => {
      send.mockResolvedValue([
        { token: 'token-a', outcome: 'accepted' },
        { token: 'token-b', outcome: 'invalid-token' },
      ]);

      await service.deliverPushNotification('notification-1');

      expect(repository.deletePushTokens).toHaveBeenCalledWith(['token-b']);
    });

    it('records FAILED without retrying when every token is invalid', async () => {
      send.mockResolvedValue([
        { token: 'token-a', outcome: 'invalid-token' },
        { token: 'token-b', outcome: 'invalid-token' },
      ]);

      await expect(
        service.deliverPushNotification('notification-1'),
      ).resolves.toBeUndefined();
      expect(repository.recordDeliveryAttempt).toHaveBeenCalledWith(
        'notification-1',
        expect.objectContaining({ status: NotificationStatus.FAILED }),
      );
    });

    it('records FAILED and rethrows a transient failure so the queue retries it', async () => {
      send.mockResolvedValue([
        { token: 'token-a', outcome: 'failed', error: 'UNAVAILABLE' },
        { token: 'token-b', outcome: 'failed', error: 'UNAVAILABLE' },
      ]);

      await expect(
        service.deliverPushNotification('notification-1'),
      ).rejects.toThrow('UNAVAILABLE');
      expect(repository.recordDeliveryAttempt).toHaveBeenCalledWith(
        'notification-1',
        expect.objectContaining({ status: NotificationStatus.FAILED }),
      );
    });

    it('does not send again once a notification is already SENT', async () => {
      repository.findNotificationById.mockResolvedValue({
        ...PUSH_ROW,
        status: NotificationStatus.SENT,
      });

      await service.deliverPushNotification('notification-1');

      expect(send).not.toHaveBeenCalled();
    });
  });

  describe('deliverNotification (admin retry)', () => {
    it('no longer records SENT for a channel with no provider', async () => {
      repository.findByIdForAdmin.mockResolvedValue({
        ...PUSH_ROW,
        channel: NotificationChannel.EMAIL,
        status: NotificationStatus.FAILED,
      });

      await service.deliverNotification('notification-1');

      expect(repository.recordDeliveryAttempt).toHaveBeenCalledWith(
        'notification-1',
        {
          status: NotificationStatus.FAILED,
          errorMessage: 'No EMAIL provider is configured',
        },
      );
    });

    it('re-emits an IN_APP notification over the socket before recording SENT', async () => {
      repository.findByIdForAdmin.mockResolvedValue({
        ...PUSH_ROW,
        channel: NotificationChannel.IN_APP,
        status: NotificationStatus.FAILED,
      });

      await service.deliverNotification('notification-1');

      expect(realtimeService.emitToUser).toHaveBeenCalledWith(
        'rider-1',
        'notification',
        expect.objectContaining({ id: 'notification-1' }),
      );
      expect(repository.recordDeliveryAttempt).toHaveBeenCalledWith(
        'notification-1',
        expect.objectContaining({ status: NotificationStatus.SENT }),
      );
    });
  });
  describe('platform routing and control metadata', () => {
    it('passes the Android channel through and keeps it out of the device data payload', async () => {
      repository.findNotificationById.mockResolvedValue({
        ...PUSH_ROW,
        metadata: {
          ...PUSH_ROW.metadata,
          androidChannelId: 'delivery_assignments',
        },
      });
      send.mockResolvedValue([{ token: 'token-a', outcome: 'accepted' }]);

      await service.deliverPushNotification('notification-1');

      const [, message] = send.mock.calls[0] as [
        unknown,
        { data: Record<string, string>; androidChannelId?: string },
      ];
      expect(message.androidChannelId).toBe('delivery_assignments');
      expect(message.data).not.toHaveProperty('androidChannelId');
      expect(message.data).not.toHaveProperty('dedupeKey');
    });

    it('records FAILED without retrying when every device was skipped (no provider for its platform)', async () => {
      send.mockResolvedValue([
        { token: 'token-a', outcome: 'skipped' },
        { token: 'token-b', outcome: 'skipped' },
      ]);

      await expect(
        service.deliverPushNotification('notification-1'),
      ).resolves.toBeUndefined();
      expect(repository.recordDeliveryAttempt).toHaveBeenCalledWith(
        'notification-1',
        expect.objectContaining({
          status: NotificationStatus.FAILED,
          errorMessage:
            'No push provider configured for the registered devices',
        }),
      );
      expect(repository.deletePushTokens).not.toHaveBeenCalled();
    });

    it('stores the Android channel on the queued row', async () => {
      await service.queuePushNotification({
        userId: 'rider-1',
        type: NotificationType.DELIVERY_ASSIGNMENT_OFFERED,
        dedupeKey: 'k',
        message: {
          title: 't',
          body: 'b',
          data: { assignmentId: 'assignment-1' },
          androidChannelId: 'delivery_assignments',
        },
      });

      expect(repository.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: {
            assignmentId: 'assignment-1',
            dedupeKey: 'k',
            androidChannelId: 'delivery_assignments',
          },
        }),
      );
    });
  });

  describe('unregisterPushToken', () => {
    it("removes only the caller's own token", async () => {
      await service.unregisterPushToken('rider-1', 'token-a');

      expect(repository.deletePushTokenForUser).toHaveBeenCalledWith(
        'rider-1',
        'token-a',
      );
    });
  });
});

describe('DeliveryAssignmentPushListener', () => {
  it('queues one generic, ids-only push per assignment offer', async () => {
    let handler: ((event: unknown) => Promise<void>) | undefined;
    const eventBus = {
      subscribe: jest.fn(
        (name: string, fn: (event: unknown) => Promise<void>) => {
          if (name === 'delivery.assignment.offered') {
            handler = fn;
          }
        },
      ),
    };
    const notificationsService = {
      queuePushNotification: jest.fn().mockResolvedValue(null),
    };

    new DeliveryAssignmentPushListener(
      eventBus as unknown as EventBusService,
      notificationsService as unknown as NotificationsService,
    ).onModuleInit();

    await handler?.({
      assignmentId: 'assignment-1',
      orderId: 'order-1',
      partnerUserId: 'rider-1',
    });

    const [request] = notificationsService.queuePushNotification.mock
      .calls[0] as [
      {
        userId: string;
        type: NotificationType;
        dedupeKey: string;
        message: { data: Record<string, string> };
      },
    ];
    expect(request).toMatchObject({
      userId: 'rider-1',
      type: NotificationType.DELIVERY_ASSIGNMENT_OFFERED,
      dedupeKey: 'delivery-assignment-offered:assignment-1',
    });
    expect(Object.keys(request.message.data).sort()).toEqual([
      'assignmentId',
      'orderId',
      'type',
    ]);
    expect(JSON.stringify(request.message)).not.toMatch(
      /phone|address|customer/i,
    );
  });
});
