import { IsLatitude, IsLongitude } from 'class-validator';

import { ApiProperty } from '@nestjs/swagger';

export class MarkRestaurantArrivalDto {
  @ApiProperty({
    example: 12.9716,
    description:
      "The rider's current latitude, checked server-side against the restaurant's pickup coordinates",
  })
  @IsLatitude()
  latitude: number;

  @ApiProperty({
    example: 77.5946,
    description:
      "The rider's current longitude, checked server-side against the restaurant's pickup coordinates",
  })
  @IsLongitude()
  longitude: number;
}
