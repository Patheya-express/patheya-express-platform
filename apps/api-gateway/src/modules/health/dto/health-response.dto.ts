import { ApiProperty } from '@nestjs/swagger';

import { HealthMemoryUsageDto } from './health-memory-usage.dto';

export class HealthResponseDto {
  @ApiProperty({
    example: 'ok',
    enum: ['ok', 'degraded'],
    description:
      '"ok" only when database, redis, and queues are all connected — otherwise "degraded"',
  })
  status: string;

  @ApiProperty({
    example: 'Patheya Express API',
  })
  service: string;

  @ApiProperty({
    example: 'connected',
  })
  database: string;

  @ApiProperty({
    example: 'connected',
  })
  redis: string;

  @ApiProperty({
    example: 'connected',
    enum: ['connected', 'disconnected'],
    description: "Reachability of the BullMQ queues' Redis connections",
  })
  queues: string;

  @ApiProperty({
    example: 'ready',
    enum: ['ready', 'not_ready', 'not_applicable'],
    description:
      'Whether the in-process Socket.IO server is bound and accepting connections — "not_applicable" for the worker process, which never runs a gateway.',
  })
  websocket: string;

  @ApiProperty({
    example: 12345,
    description: 'Process uptime in seconds',
  })
  uptime: number;

  @ApiProperty({
    type: HealthMemoryUsageDto,
  })
  memory: HealthMemoryUsageDto;

  @ApiProperty({
    example: '2026-07-04T10:00:00.000Z',
  })
  timestamp: string;
}
