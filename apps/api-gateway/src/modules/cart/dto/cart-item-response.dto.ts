import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CartItemAddonOptionResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  price: number;
}

export class CartItemResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  menuItemId: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional()
  imageUrl?: string;

  @ApiPropertyOptional()
  variantId?: string;

  @ApiPropertyOptional()
  variantName?: string;

  @ApiProperty({
    description:
      'Base unit price of the selected variant, or the item, excluding addons',
  })
  unitPrice: number;

  @ApiProperty({ type: [CartItemAddonOptionResponseDto] })
  addonOptions: CartItemAddonOptionResponseDto[];

  @ApiProperty()
  quantity: number;

  @ApiProperty({ description: '(unitPrice + sum of addon prices) * quantity' })
  lineTotal: number;

  @ApiPropertyOptional()
  specialInstructions?: string;

  @ApiProperty({
    description: 'False if the menu item has since been marked unavailable',
  })
  isAvailable: boolean;
}
