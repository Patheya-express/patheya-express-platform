import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type SearchSuggestionType = 'RESTAURANT' | 'CUISINE' | 'MENU_ITEM';

export class SearchSuggestionDto {
  @ApiProperty({ enum: ['RESTAURANT', 'CUISINE', 'MENU_ITEM'] })
  type: SearchSuggestionType;

  @ApiProperty() id: string;
  @ApiProperty() label: string;

  @ApiPropertyOptional({
    description:
      'Present for MENU_ITEM suggestions — the restaurant it belongs to.',
  })
  restaurantId?: string;
}
