import { ApiProperty } from '@nestjs/swagger';

import { RestaurantResponseDto } from './restaurant-response.dto';

export class PaginatedRestaurantsResponseDto {
  @ApiProperty({
    type: [RestaurantResponseDto],
  })
  items: RestaurantResponseDto[];

  @ApiProperty({
    example: 42,
  })
  total: number;

  @ApiProperty({
    example: 1,
  })
  page: number;

  @ApiProperty({
    example: 20,
  })
  limit: number;

  @ApiProperty({
    example: 3,
  })
  totalPages: number;
}
