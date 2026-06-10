import {
  IsLatitude,
  IsLongitude,
  IsString,
} from 'class-validator';

import {
  ApiProperty,
} from '@nestjs/swagger';

export class UpdateLocationDto {

  @ApiProperty({
    example: 'clx123abc456',
    description:
      'Order ID associated with the tracking update',
  })
  @IsString()
  orderId: string;

  @ApiProperty({
    example: 12.9716,
    description:
      'Current latitude of delivery partner',
  })
  @IsLatitude()
  latitude: number;

  @ApiProperty({
    example: 77.5946,
    description:
      'Current longitude of delivery partner',
  })
  @IsLongitude()
  longitude: number;

}