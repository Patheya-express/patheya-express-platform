import { ApiProperty } from '@nestjs/swagger';

export class HealthMemoryUsageDto {
  @ApiProperty({
    example: 52428800,
    description: 'Resident set size in bytes',
  })
  rss: number;

  @ApiProperty({
    example: 20971520,
    description: 'Used V8 heap size in bytes',
  })
  heapUsed: number;

  @ApiProperty({
    example: 41943040,
    description: 'Total V8 heap size in bytes',
  })
  heapTotal: number;
}
