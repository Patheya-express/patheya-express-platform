import { IsEmail, IsOptional, IsString, IsUrl } from 'class-validator';

import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Restaurant profile is editable via this DTO after creation — previously the only mutation
 * path was `CreateRestaurantDto` at creation time. `slug` is deliberately not editable here
 * since it's part of the public restaurant URL.
 */
export class UpdateRestaurantDto {
  @ApiPropertyOptional({ example: 'Patheya Express' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'Premium multi cuisine restaurant' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: '+919876543210' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 'restaurant@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    example: 'Patheya Foods Private Limited',
    description:
      'Registered legal name, distinct from the public-facing name/brand.',
  })
  @IsOptional()
  @IsString()
  legalBusinessName?: string;

  @ApiPropertyOptional({ example: 'Patheya Express' })
  @IsOptional()
  @IsString()
  tradeName?: string;

  @ApiPropertyOptional({ example: 'Patheya' })
  @IsOptional()
  @IsString()
  brandName?: string;

  @ApiPropertyOptional({ example: 'support@patheyaexpress.com' })
  @IsOptional()
  @IsEmail()
  supportEmail?: string;

  @ApiPropertyOptional({ example: '+919876543211' })
  @IsOptional()
  @IsString()
  supportPhone?: string;

  @ApiPropertyOptional({ example: 'business@patheyaexpress.com' })
  @IsOptional()
  @IsEmail()
  businessEmail?: string;

  @ApiPropertyOptional({ example: '+919876543212' })
  @IsOptional()
  @IsString()
  businessPhone?: string;

  @ApiPropertyOptional({ example: 'https://patheyaexpress.com' })
  @IsOptional()
  @IsUrl()
  website?: string;

  @ApiPropertyOptional({
    description:
      'Forward-compatible pointer to a future Business/franchise aggregate — no Business table exists yet, so this is a plain identifier with no referential integrity enforced.',
  })
  @IsOptional()
  @IsString()
  businessId?: string;
}
