import {
    IsOptional,
    IsString,
  } from 'class-validator';
  
  import {
    ApiProperty,
    ApiPropertyOptional,
  } from '@nestjs/swagger';
  
  export class CreateCategoryDto {
  
    @ApiProperty({
      example:
        '8f2e0a21-7c48-4d72-a0c0-123456789abc',
    })
    @IsString()
    restaurantId: string;
  
    @ApiProperty({
      example: 'Biryani',
    })
    @IsString()
    name: string;
  
    @ApiPropertyOptional({
      example:
        'Traditional Dum Biryani',
    })
    @IsOptional()
    @IsString()
    description?: string;
  
  }