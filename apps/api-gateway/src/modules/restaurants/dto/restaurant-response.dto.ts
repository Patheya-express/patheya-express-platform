import {
    ApiProperty,
    ApiPropertyOptional,
  } from '@nestjs/swagger';
  
  import {
    RestaurantStatus,
  } from '@prisma/client';
  
  export class RestaurantResponseDto {
  
    @ApiProperty({
      example:
        'c7c1f1e2-6f2d-4f77-a111-123456789abc',
    })
    id: string;
  
    @ApiProperty({
      example:
        'c7c1f1e2-6f2d-4f77-a111-123456789abc',
    })
    ownerId: string;
  
    @ApiProperty({
      example: 'Patheya Express',
    })
    name: string;
  
    @ApiProperty({
      example: 'patheya-express',
    })
    slug: string;
  
    @ApiPropertyOptional({
      example:
        'Premium multi cuisine restaurant',
    })
    description?: string;
  
    @ApiPropertyOptional({
      example: '+919876543210',
    })
    phone?: string;
  
    @ApiPropertyOptional({
      example:
        'restaurant@example.com',
    })
    email?: string;
  
    @ApiPropertyOptional({
      example:
        'https://cdn.patheya.com/logo.png',
    })
    logoUrl?: string;
  
    @ApiPropertyOptional({
      example:
        'https://cdn.patheya.com/banner.png',
    })
    bannerUrl?: string;
  
    @ApiProperty({
      enum: RestaurantStatus,
    })
    status: RestaurantStatus;
  
    @ApiProperty({
      example: true,
    })
    isActive: boolean;
  
    @ApiProperty({
      example:
        '2026-05-29T10:00:00.000Z',
    })
    createdAt: Date;
  
    @ApiProperty({
      example:
        '2026-05-29T10:00:00.000Z',
    })
    updatedAt: Date;
  
  }