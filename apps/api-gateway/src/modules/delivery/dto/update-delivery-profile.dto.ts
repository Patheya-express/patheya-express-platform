import { ApiPropertyOptional } from '@nestjs/swagger';

import { Gender } from '@prisma/client';

import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsOptional,
  IsString,
} from 'class-validator';

export class UpdateDeliveryProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dateOfBirth?: Date;

  @ApiPropertyOptional({ enum: Gender })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  permanentAddressLine1?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  permanentAddressLine2?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() permanentCity?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() permanentState?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() permanentPostalCode?: string;
  @ApiPropertyOptional() @IsOptional() permanentLatitude?: number;
  @ApiPropertyOptional() @IsOptional() permanentLongitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  sameAsPermanentAddress?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsString() currentAddressLine1?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() currentAddressLine2?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() currentCity?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() currentState?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() currentPostalCode?: string;
  @ApiPropertyOptional() @IsOptional() currentAddressLatitude?: number;
  @ApiPropertyOptional() @IsOptional() currentAddressLongitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  emergencyContactName?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  emergencyContactPhone?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  emergencyContactRelation?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['English', 'Hindi', 'Telugu'],
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  languagesSpoken?: string[];
}
