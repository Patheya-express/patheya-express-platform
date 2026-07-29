import { Matches } from 'class-validator';

import { ApiProperty } from '@nestjs/swagger';

export class VerifyProofOtpDto {
  @ApiProperty({
    example: '123456',
    description:
      'The 6-digit code the customer shared with the delivery partner',
  })
  @Matches(/^\d{6}$/, { message: 'code must be a 6-digit numeric code' })
  code: string;
}
