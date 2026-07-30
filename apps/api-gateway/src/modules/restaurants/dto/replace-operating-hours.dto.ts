import { ApiProperty } from '@nestjs/swagger';

import { Type } from 'class-transformer';
import { ArrayMaxSize, ValidateNested } from 'class-validator';

import { UpsertOperatingHourDto } from './upsert-operating-hour.dto';

export class ReplaceOperatingHoursDto {
  @ApiProperty({
    type: [UpsertOperatingHourDto],
    description:
      'The full weekly schedule for this branch — replaces every existing entry. Include ' +
      'multiple entries with the same dayOfWeek for split shifts (e.g. lunch + dinner), or a ' +
      'single isClosed entry for a day the branch does not operate.',
  })
  @ValidateNested({ each: true })
  @Type(() => UpsertOperatingHourDto)
  @ArrayMaxSize(21)
  hours: UpsertOperatingHourDto[];
}
