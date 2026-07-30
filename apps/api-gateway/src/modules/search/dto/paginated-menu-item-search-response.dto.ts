import { ApiProperty } from '@nestjs/swagger';

import { MenuItemSearchResultDto } from './menu-item-search-result.dto';

export class PaginatedMenuItemSearchResponseDto {
  @ApiProperty({ type: [MenuItemSearchResultDto] })
  items: MenuItemSearchResultDto[];

  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() totalPages: number;
}
