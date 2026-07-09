import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MenuItemSearchResultDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional() description?: string;
  @ApiPropertyOptional() imageUrl?: string;
  @ApiProperty() basePrice: number;
  @ApiProperty() isVegetarian: boolean;
  @ApiProperty() isVegan: boolean;
  @ApiProperty() restaurantId: string;
  @ApiProperty() restaurantName: string;
  @ApiProperty() restaurantSlug: string;
}
