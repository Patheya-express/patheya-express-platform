import { ApiProperty } from '@nestjs/swagger';

import { ArrayMinSize, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class DeliveryOnboardingChangeItemDto {
  @ApiProperty({
    example: 'documents',
    description:
      'Wizard section key, e.g. personal, address, vehicle, documents, bank.',
  })
  @IsString()
  section: string;

  @ApiProperty({
    example: 'Driving license photo is unreadable — please re-upload.',
  })
  @IsString()
  reason: string;
}

export class RequestDeliveryOnboardingChangesDto {
  @ApiProperty({ type: [DeliveryOnboardingChangeItemDto] })
  @ValidateNested({ each: true })
  @Type(() => DeliveryOnboardingChangeItemDto)
  @ArrayMinSize(1)
  items: DeliveryOnboardingChangeItemDto[];
}
