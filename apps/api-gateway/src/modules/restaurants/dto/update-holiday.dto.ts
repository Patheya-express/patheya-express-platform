import { PartialType, OmitType } from '@nestjs/swagger';

import { CreateHolidayDto } from './create-holiday.dto';

export class UpdateHolidayDto extends PartialType(
  OmitType(CreateHolidayDto, ['branchId'] as const),
) {}
