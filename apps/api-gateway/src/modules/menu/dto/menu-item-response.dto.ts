import { ApiProperty } from '@nestjs/swagger';

import { MenuItemVariantResponseDto } from './menu-item-variant-response.dto';

import { MenuAddonResponseDto } from './menu-addon-response.dto';

export class MenuItemResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  categoryId: string;

  @ApiProperty({
    example: 'Chicken Biryani',
  })
  name: string;

  @ApiProperty({
    required: false,
  })
  description?: string;

  @ApiProperty({
    example: 249,
  })
  basePrice: number;

  @ApiProperty()
  isVegetarian: boolean;

  @ApiProperty()
  isVegan: boolean;

  @ApiProperty()
  isAvailable: boolean;

  @ApiProperty({
    type: [MenuItemVariantResponseDto],
  })
  variants: MenuItemVariantResponseDto[];

  @ApiProperty({
    type: [MenuAddonResponseDto],
  })
  addons: MenuAddonResponseDto[];
}
