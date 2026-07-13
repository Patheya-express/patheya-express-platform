import { ApiProperty } from '@nestjs/swagger';

export class ReadinessResponseDto {
  @ApiProperty({
    example: 'ok',
    description:
      '"ok" if every checked dependency is reachable, otherwise "degraded"',
  })
  status: string;

  @ApiProperty({
    example: 'connected',
    enum: ['connected', 'disconnected'],
  })
  database: string;

  @ApiProperty({
    example: 'connected',
    enum: ['connected', 'disconnected'],
  })
  redis: string;

  @ApiProperty({
    example: 'connected',
    enum: ['connected', 'disconnected'],
    description: "Reachability of the BullMQ queues' Redis connections",
  })
  queues: string;

  @ApiProperty({
    example: '2026-07-04T10:00:00.000Z',
  })
  timestamp: string;
}
