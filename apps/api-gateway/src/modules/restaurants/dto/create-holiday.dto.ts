import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import {
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export class CreateHolidayDto {
  @ApiProperty({
    example: '2026-10-21',
    description: 'Calendar date (YYYY-MM-DD).',
  })
  @IsDateString()
  date: string;

  @ApiProperty({ example: 'Diwali' })
  @IsString()
  name: string;

  @ApiPropertyOptional({
    description:
      'Applies to one branch only. Omit to apply to every branch of the restaurant.',
  })
  @IsOptional()
  @IsString()
  branchId?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isClosed?: boolean;

  @ApiPropertyOptional({
    example: '11:00',
    description: 'Required when isClosed is false.',
  })
  @IsOptional()
  @IsString()
  @Matches(TIME_PATTERN, {
    message: 'specialOpensAt must be in HH:mm 24-hour format',
  })
  specialOpensAt?: string;

  @ApiPropertyOptional({
    example: '15:00',
    description: 'Required when isClosed is false.',
  })
  @IsOptional()
  @IsString()
  @Matches(TIME_PATTERN, {
    message: 'specialClosesAt must be in HH:mm 24-hour format',
  })
  specialClosesAt?: string;
}
