import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AddCartItemDto {
  @ApiProperty({ example: '8f2e0a21-7c48-4d72-a0c0-123456789abc' })
  @IsString()
  menuItemId: string;

  @ApiPropertyOptional({ example: 'a1b2c3d4-0000-4d72-a0c0-123456789abc' })
  @IsOptional()
  @IsString()
  variantId?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  addonOptionIds?: string[];

  @ApiProperty({ minimum: 1, example: 1 })
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  specialInstructions?: string;

  @ApiPropertyOptional({
    description:
      'Confirms replacing the existing cart when it belongs to a different restaurant.',
  })
  @IsOptional()
  @IsBoolean()
  replaceExisting?: boolean;
}
