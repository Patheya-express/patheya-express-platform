import { ApiProperty } from '@nestjs/swagger';

export class FavoriteToggleResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty()
  isFavorited: boolean;
}
