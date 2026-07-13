import { ApiProperty } from '@nestjs/swagger';

import { ArrayMinSize, IsArray, IsString } from 'class-validator';

export class ReorderMediaDto {
  @ApiProperty({
    type: [String],
    description:
      'Media ids in the desired display order — sortOrder is assigned from array position.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  mediaIds: string[];
}
