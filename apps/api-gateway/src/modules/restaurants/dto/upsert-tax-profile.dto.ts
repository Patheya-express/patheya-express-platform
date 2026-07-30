import { ApiPropertyOptional } from '@nestjs/swagger';

import { BusinessType } from '@prisma/client';

import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsOptional, IsString } from 'class-validator';

export class UpsertTaxProfileDto {
  @ApiPropertyOptional({ example: '29ABCDE1234F1Z5' })
  @IsOptional()
  @IsString()
  gstin?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  gstLegalName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  gstRegisteredAddress?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  gstBusinessCategory?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  gstRegistrationState?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fssaiNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fssaiLicenseType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  fssaiIssueDate?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  fssaiExpiryAt?: Date;

  @ApiPropertyOptional({ example: 'AAAAA0000A' })
  @IsOptional()
  @IsString()
  pan?: string;

  @ApiPropertyOptional({
    description: 'Corporate Identification Number, for registered companies.',
  })
  @IsOptional()
  @IsString()
  cin?: string;

  @ApiPropertyOptional({ enum: BusinessType })
  @IsOptional()
  @IsEnum(BusinessType)
  businessType?: BusinessType;
}
