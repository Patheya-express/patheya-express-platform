import { IsString } from 'class-validator';

import { ApiProperty } from '@nestjs/swagger';

export class FavoriteStatusQueryDto {
  @ApiProperty({
    description: 'Comma-separated list of ids to check favorite status for.',
    example: 'a1b2c3,d4e5f6',
  })
  @IsString()
  ids: string;
}
