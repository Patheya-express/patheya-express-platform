import { ApiProperty } from '@nestjs/swagger';

export class RestaurantCuisineSummaryDto {
  @ApiProperty({
    example: 'North Indian',
  })
  name: string;
}
