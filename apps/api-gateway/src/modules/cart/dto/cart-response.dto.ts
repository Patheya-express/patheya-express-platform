import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { CartItemResponseDto } from './cart-item-response.dto';

export class CartResponseDto {
  @ApiProperty()
  id: string;

  @ApiPropertyOptional()
  restaurantId?: string;

  @ApiPropertyOptional()
  restaurantName?: string;

  @ApiProperty({ type: [CartItemResponseDto] })
  items: CartItemResponseDto[];

  @ApiProperty()
  subtotal: number;

  @ApiProperty()
  totalItems: number;
}
