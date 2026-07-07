import { ApiProperty } from '@nestjs/swagger';

import { HealthMemoryUsageDto } from './health-memory-usage.dto';

export class HealthResponseDto {
  @ApiProperty({
    example: 'ok',
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
