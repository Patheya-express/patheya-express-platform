import { ApiProperty } from '@nestjs/swagger';

export class AdminOrderRestaurantSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;
}
