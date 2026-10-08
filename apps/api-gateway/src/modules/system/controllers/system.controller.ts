import { Controller, Get, Param, UseGuards } from '@nestjs/common';

import { ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

import { UserRole } from '@prisma/client';

import { RedisService } from '../../../infrastructure/redis/redis.service';
import { QueueService } from '../../../infrastructure/queues/queue.service';
import { PresenceService } from '../../presence/services/presence.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';

// Never registered in production (see systemModulesFor). Elsewhere: admin-only, since these
// write to Redis / enqueue jobs and QA/staging are internet-facing.
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@Controller('system')
export class SystemController {
  constructor(
    private readonly redisService: RedisService,
    private readonly queueService: QueueService,
    private readonly presenceService: PresenceService,
  ) {}

  @Get('redis-test')
  @ApiOperation({ summary: 'Redis connectivity smoke test' })
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
  @ApiOperation({ summary: 'BullMQ queue connectivity smoke test' })
  async queueTest() {
    await this.queueService.addNotificationJob({
      message: 'Hello Queue',
    });

    return {
      success: true,
    };
  }
  @Get('queue-health')
  @ApiOperation({ summary: 'Queue module load status' })
  async queueHealth() {
    return {
      success: true,

      message: 'Queue module loaded',
    };
  }
  @Get('presence-test/:partnerId')
  @ApiOperation({
    summary: 'Presence status smoke test for a delivery partner',
  })
  async presenceTest(
    @Param('partnerId')
    id: string,
  ) {
    return this.presenceService.getStatus('partnerId');
  }
}
