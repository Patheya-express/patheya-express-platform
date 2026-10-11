import { Module } from '@nestjs/common';
import { QueueBacklogPublisher } from './queue-backlog-publisher.service';

/**
 * Worker-only: imported by WorkerModule, never AppModule, so exactly one kind of process (the
 * ECS worker) publishes queue backlog. The six Queue clients come from the @Global()
 * QueueProducerModule.
 */
@Module({
  providers: [QueueBacklogPublisher],
})
export class QueueMetricsModule {}
