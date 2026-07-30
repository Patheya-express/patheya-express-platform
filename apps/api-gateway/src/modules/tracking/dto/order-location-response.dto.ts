import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class OrderLocationResponseDto {
  @ApiProperty({ example: 12.9716 })
  latitude: number;

  @ApiProperty({ example: 77.5946 })
  longitude: number;

  @ApiProperty()
  updatedAt: Date;

  @ApiPropertyOptional({
    description:
      "Straight-line distance to the order's delivery destination, in kilometers",
    example: 3.2,
  })
  distanceKm?: number;

  @ApiPropertyOptional({
    description:
      'Estimated minutes until arrival, based on straight-line distance and an assumed average delivery speed',
    example: 8,
  })
  etaMinutes?: number;
}
