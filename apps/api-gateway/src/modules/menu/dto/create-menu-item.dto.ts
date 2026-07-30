import { IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateMenuItemDto {
  @ApiProperty({ example: '8f2e0a21-7c48-4d72-a0c0-123456789abc' })
  @IsString()
  categoryId: string;

  @ApiProperty({ example: 'Chicken Biryani' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'Traditional Dum Biryani' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 249 })
  @IsNumber()
  basePrice: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isVegetarian?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isVegan?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  imageUrl?: string;
}
