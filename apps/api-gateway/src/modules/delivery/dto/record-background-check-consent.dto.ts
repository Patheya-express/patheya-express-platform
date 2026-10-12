import { ApiProperty } from '@nestjs/swagger';
import { Equals } from 'class-validator';

export class RecordBackgroundCheckConsentDto {
  @ApiProperty({
    example: true,
    description:
      'Must be true — the partner explicitly consents to the background verification check.',
  })
  @Equals(true, {
    message: 'consent must be true to record background-check consent',
  })
  consent: boolean;
}
