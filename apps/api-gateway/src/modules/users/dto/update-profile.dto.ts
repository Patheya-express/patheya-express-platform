import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { ApiPropertyOptional } from '@nestjs/swagger';

import { ThemePreference } from '@prisma/client';

export class UpdateProfileDto {
  @ApiPropertyOptional({
    example: 'Hari',
    description: 'User first name',
  })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiPropertyOptional({
    example: 'Haran',
    description: 'User last name',
  })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiPropertyOptional({
    example: '+919876543210',
    description: 'User phone number',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({
    example: 'en',
    description: 'Preferred language (ISO 639-1 code)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  preferredLanguage?: string;

  @ApiPropertyOptional({
    enum: ThemePreference,
    example: ThemePreference.SYSTEM,
  })
  @IsOptional()
  @IsEnum(ThemePreference)
  themePreference?: ThemePreference;

  @ApiPropertyOptional({
    example: false,
    description: 'Whether the user has opted in to marketing communications',
  })
  @IsOptional()
  @IsBoolean()
  marketingOptIn?: boolean;

  @ApiPropertyOptional({
    example: 'Asia/Kolkata',
    description: 'IANA timezone identifier',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;
}
