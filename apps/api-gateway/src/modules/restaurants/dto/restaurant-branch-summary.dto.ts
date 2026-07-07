import { ApiProperty } from '@nestjs/swagger';

export class RestaurantBranchSummaryDto {
  @ApiProperty({
    example: 'Bengaluru',
  })
  city: string;
}
