import { ApiProperty } from '@nestjs/swagger';

import { MenuItemResponseDto } from '../../menu/dto/menu-item-response.dto';

export class PaginatedFavoriteMenuItemsResponseDto {
  @ApiProperty({
    type: [MenuItemResponseDto],
  })
  items: MenuItemResponseDto[];

  @ApiProperty({
    example: 42,
  })
  total: number;

  @ApiProperty({
    example: 1,
  })
  page: number;

  @ApiProperty({
    example: 20,
  })
  limit: number;

  @ApiProperty({
    example: 3,
  })
  totalPages: number;
}
