import { ApiProperty } from '@nestjs/swagger';

import { RestaurantSummaryDto } from './restaurant-summary.dto';

export class PaginatedRestaurantSummariesResponseDto {
  @ApiProperty({
    type: [RestaurantSummaryDto],
  })
  items: RestaurantSummaryDto[];

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
