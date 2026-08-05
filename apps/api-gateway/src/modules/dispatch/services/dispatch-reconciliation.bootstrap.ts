import { Injectable, OnModuleInit } from '@nestjs/common';

import { QueueService } from '../../../infrastructure/queues/queue.service';

import { AppLoggerService } from '../../../infrastructure/logger/logger.service';

@Injectable()
export class DispatchReconciliationBootstrap implements OnModuleInit {
  constructor(
    private readonly queueService: QueueService,
    private readonly logger: AppLoggerService,
  ) {}

  /** Production Readiness Stage D (Logging Audit): previously silent on both success and
   *  failure — a misregistered scheduler (e.g. Redis unreachable at boot) would be invisible
   *  until someone noticed stranded orders piling up with no periodic re-scan running. */
  async onModuleInit() {
    try {
      await this.queueService.addDispatchReconciliationJob();

      this.logger.log(
        { event: 'scheduler_registered', scheduler: 'dispatch-reconciliation' },
        'DispatchReconciliationBootstrap',
      );
    } catch (error) {
      this.logger.error(
        {
          event: 'scheduler_registration_failed',
          scheduler: 'dispatch-reconciliation',
          reason: error instanceof Error ? error.message : String(error),
        },
        error instanceof Error ? error.stack : undefined,
        'DispatchReconciliationBootstrap',
      );

      throw error;
    }
  }
}
