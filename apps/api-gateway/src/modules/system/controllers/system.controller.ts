import { Controller, Get, Param } from '@nestjs/common';

import { RedisService } from '../../../infrastructure/redis/redis.service';
import { QueueService } from 'src/infrastructure/queues/queue.service';
import { PresenceService } from 'src/modules/presence/services/presence.service';

@Controller('system')
export class SystemController {
  constructor(
    private readonly redisService: RedisService,
    private readonly queueService: QueueService,
    private readonly presenceService: PresenceService,
  ) {}

  @Get('redis-test')
  async testRedis() {
    await this.redisService.set(
      'test',

      'patheya',

      60,
    );

    const value = await this.redisService.get('test');

    return {
      success: true,

      value,
    };
  }
  @Get('queue-test')
  async queueTest() {
    await this.queueService.addNotificationJob({
      message: 'Hello Queue',
    });

    return {
      success: true,
    };
  }
  @Get('queue-health')
  async queueHealth() {
    return {
      success: true,

      message: 'Queue module loaded',
    };
  }
  @Get('presence-test/:partnerId')
  async presenceTest(
    @Param('partnerId')
    id: string,
  ) {
    return this.presenceService.getStatus('partnerId');
  }
}
