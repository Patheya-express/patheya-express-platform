import { ApiProperty } from '@nestjs/swagger';

export class FavoriteStatusItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  isFavorited: boolean;
}
