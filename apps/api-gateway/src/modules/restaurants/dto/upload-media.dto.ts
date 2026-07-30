import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { RestaurantMediaType } from '@prisma/client';

import { IsEnum, IsOptional, IsString } from 'class-validator';

export class UploadMediaDto {
  @ApiProperty({ enum: RestaurantMediaType })
  @IsEnum(RestaurantMediaType)
  type: RestaurantMediaType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  branchId?: string;
}
