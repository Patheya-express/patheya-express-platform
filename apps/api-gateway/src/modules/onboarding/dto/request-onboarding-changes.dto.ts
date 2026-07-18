import { ApiProperty } from '@nestjs/swagger';

import { ArrayMinSize, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class OnboardingChangeItemDto {
  @ApiProperty({
    example: 'bank',
    description: 'Wizard section key, e.g. business, location, bank, gst.',
  })
  @IsString()
  section: string;

  @ApiProperty({
    example: 'Account holder name does not match the PAN card on file.',
  })
  @IsString()
  reason: string;
}

export class RequestOnboardingChangesDto {
  @ApiProperty({ type: [OnboardingChangeItemDto] })
  @ValidateNested({ each: true })
  @Type(() => OnboardingChangeItemDto)
  @ArrayMinSize(1)
  items: OnboardingChangeItemDto[];
}
