import { IsOptional, IsString } from 'class-validator';

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRestaurantDto {
  @ApiProperty({
    example: 'Patheya Express',
    description: 'Restaurant name',
  })
  @IsString()
  name: string;

  @ApiProperty({
    example: 'patheya-express',
    description: 'Unique restaurant slug',
  })
  @IsString()
  slug: string;

  @ApiPropertyOptional({
    example: 'Premium multi cuisine restaurant',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    example: '+919876543210',
  })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({
    example: 'restaurant@example.com',
  })
  @IsOptional()
  @IsString()
  email?: string;
}
