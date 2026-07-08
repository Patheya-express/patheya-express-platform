import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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

  @ApiPropertyOptional()
  imageUrl?: string;

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

  @ApiPropertyOptional({
    description:
      'Populated when the item is returned outside its own category listing (e.g. favorites).',
  })
  restaurantId?: string;

  @ApiPropertyOptional({
    description:
      'Populated when the item is returned outside its own category listing (e.g. favorites).',
  })
  restaurantName?: string;
}
