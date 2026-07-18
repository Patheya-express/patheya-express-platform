import { Processor, WorkerHost } from '@nestjs/bullmq';

import { Job } from 'bullmq';

import { NotificationsService } from '../../../modules/notifications/services/notifications.service';

import { AppLoggerService } from '../../logger/logger.service';

interface NotificationJobData {
  type?: string;
  notificationId?: string;
  [key: string]: unknown;
}

@Processor('notifications')
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
