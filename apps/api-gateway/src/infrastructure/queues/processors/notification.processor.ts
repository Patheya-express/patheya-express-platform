import { Processor, WorkerHost } from '@nestjs/bullmq';

import { Job } from 'bullmq';

import { NotificationsService } from '../../../modules/notifications/services/notifications.service';

import { AppLoggerService } from '../../logger/logger.service';

interface NotificationJobData {
  type?: string;
  notificationId?: string;
  [key: string]: unknown;
}

/**
 * Production Readiness Stage C: concurrency raised from BullMQ's default of 1 — every job here
 * processes one independent `notificationId`/user, with no shared in-memory state and no
 * ordering requirement between notifications, so serializing them provided no correctness
 * benefit while directly capping throughput on the queue every order/dispatch/ticket event in
 * the system funnels through. 10 chosen conservatively (I/O-bound job body — one Prisma read +
 * write per notification — well within a single worker process's capacity; not raised further
 * without real production throughput data to justify it).
 */
@Processor('notifications', { concurrency: 10 })
export class NotificationProcessor extends WorkerHost {
  constructor(
    private readonly notificationsService: NotificationsService,

    private readonly logger: AppLoggerService,
  ) {
    super();
  }

  async process(job: Job<NotificationJobData>) {
    if (job.data?.type === 'retry-notification' && job.data.notificationId) {
      await this.notificationsService.deliverNotification(
        job.data.notificationId,
      );

      return true;
    }

    this.logger.log(
      {
        event: 'notification_job_processed',
        jobName: job.name,
        data: job.data,
      },
      'NotificationProcessor',
    );

    return true;
  }
}
