import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
} from 'class-validator';

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { OfferType } from '@prisma/client';

export class CreateOfferDto {
  @ApiProperty({
    example: '8f2e0a21-7c48-4d72-a0c0-123456789abc',
  })
  @IsString()
  restaurantId: string;

  @ApiProperty({
    example: 'Flat 20% off on your first order',
  })
  @IsString()
  title: string;

  @ApiPropertyOptional({
    example: 'Valid on orders above ₹299',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    example: 'https://cdn.patheya.com/offers/welcome-banner.png',
  })
  @IsOptional()
  @IsUrl()
  imageUrl?: string;

  @ApiPropertyOptional({
    description:
      'Deep link the banner navigates to when tapped — e.g. a restaurant page.',
  })
  @IsOptional()
  @IsString()
  linkUrl?: string;

  @ApiPropertyOptional({
    enum: OfferType,
  })
  @IsOptional()
  @IsEnum(OfferType)
  type?: OfferType;

  @ApiPropertyOptional({
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'When the offer becomes visible. Omit for immediately.',
  })
  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @ApiPropertyOptional({
    description: 'When the offer stops being visible. Omit for no end date.',
  })
  @IsOptional()
  @IsDateString()
  endsAt?: string;
}
