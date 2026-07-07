import { Processor, WorkerHost } from '@nestjs/bullmq';

import { Job } from 'bullmq';

import { NotificationsService } from '../../../modules/notifications/services/notifications.service';

@Processor('notifications')
export class NotificationProcessor extends WorkerHost {
  constructor(private readonly notificationsService: NotificationsService) {
    super();
  }

  async process(job: Job) {
    if (job.data?.type === 'retry-notification') {
      await this.notificationsService.deliverNotification(job.data.notificationId);

      return true;
    }

    console.log('Processing notification:', job.data);

    return true;
  }
}
