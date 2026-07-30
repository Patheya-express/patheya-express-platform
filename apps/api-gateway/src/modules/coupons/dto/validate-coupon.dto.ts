import { IsNumber, IsString, Min } from 'class-validator';

import { ApiProperty } from '@nestjs/swagger';

export class ValidateCouponDto {
  @ApiProperty({ example: 'WELCOME50' })
  @IsString()
  code: string;

  @ApiProperty({
    description: "The restaurant the customer's cart belongs to.",
  })
  @IsString()
  restaurantId: string;

  @ApiProperty({
    description:
      "The cart's current subtotal, used for minOrderAmount and discount calculation.",
    example: 499,
  })
  @IsNumber()
  @Min(0)
  subtotal: number;
}
