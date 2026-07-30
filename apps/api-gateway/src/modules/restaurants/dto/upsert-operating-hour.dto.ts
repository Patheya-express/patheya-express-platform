import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * One shift window for one day of the week. Split shifts (e.g. lunch + dinner) are represented
 * as two entries sharing the same dayOfWeek — see computeIsOpenNow().
 */
export class UpsertOperatingHourDto {
  @ApiProperty({ example: 1, description: '0 = Sunday .. 6 = Saturday' })
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number;

  @ApiProperty({ example: '10:00' })
  @IsString()
  @Matches(TIME_PATTERN, { message: 'opensAt must be in HH:mm 24-hour format' })
  opensAt: string;

  @ApiProperty({ example: '23:00' })
  @IsString()
  @Matches(TIME_PATTERN, {
    message: 'closesAt must be in HH:mm 24-hour format',
  })
  closesAt: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isClosed?: boolean;
}
