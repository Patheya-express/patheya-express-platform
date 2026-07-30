import { ApiProperty } from '@nestjs/swagger';

import { RestaurantSummaryDto } from '../../restaurants/dto/restaurant-summary.dto';
import { MenuItemSearchResultDto } from './menu-item-search-result.dto';

export class GlobalSearchResponseDto {
  @ApiProperty({ type: [RestaurantSummaryDto] })
  restaurants: RestaurantSummaryDto[];

  @ApiProperty({ type: [MenuItemSearchResultDto] })
  menuItems: MenuItemSearchResultDto[];
}
