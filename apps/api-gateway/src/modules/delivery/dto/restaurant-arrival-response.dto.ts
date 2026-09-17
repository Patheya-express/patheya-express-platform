import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RestaurantArrivalResponseDto {
  @ApiProperty()
  orderId: string;

  @ApiPropertyOptional({
    type: Date,
    description: 'Null if the rider has not yet marked arrival for this order.',
  })
  arrivedAtRestaurantAt?: Date | null;
}
