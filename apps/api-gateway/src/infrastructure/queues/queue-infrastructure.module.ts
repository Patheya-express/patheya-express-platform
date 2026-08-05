import { Module } from '@nestjs/common';

import { BullModule } from '@nestjs/bullmq';

import { getRedisConnectionOptions } from '../redis/redis-connection.config';

/**
 * Registers the single shared BullMQ connection configuration used by every queue in this
 * process, producer or worker side alike. Split out of the former `QueuesModule` so the API
 * process can depend on just the connection config + `QueueProducerModule` without also pulling
 * in `QueueWorkerModule`'s processors (the root cause of the API process running redundant
 * BullMQ Workers — see the Redis architecture audit).
 */
@Module({
  imports: [
    BullModule.forRoot({
      connection: getRedisConnectionOptions(),
    }),
  ],
})
export class QueueInfrastructureModule {}
