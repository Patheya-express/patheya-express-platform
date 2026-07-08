import { ApiProperty } from '@nestjs/swagger';

export class OrderItemAddonOptionResponseDto {
  @ApiProperty({
    description:
      'The current menu addon option this selection was made from — used to reconstruct a cart line when reordering.',
  })
  addonOptionId: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  price: number;
}

export class OrderItemResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  menuItemId: string;

  @ApiProperty({
    required: false,
  })
  menuItemName?: string;

  @ApiProperty({
    required: false,
  })
  variantId?: string;

  @ApiProperty({
    required: false,
  })
  variantName?: string;

  @ApiProperty({
    type: [OrderItemAddonOptionResponseDto],
  })
  addonOptions: OrderItemAddonOptionResponseDto[];

  @ApiProperty({
    example: 2,
  })
  quantity: number;

  @ApiProperty({
    example: 249,
  })
  unitPrice: number;

  @ApiProperty({
    example: 498,
  })
  totalPrice: number;

  @ApiProperty({
    required: false,
  })
  specialInstructions?: string;
}
