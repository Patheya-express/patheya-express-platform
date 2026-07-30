import { ApiProperty } from '@nestjs/swagger';

import { IsString, MinLength } from 'class-validator';

export class RejectDeliveryVerificationDto {
  @ApiProperty({
    example: 'Driving license number does not match the uploaded document.',
  })
  @IsString()
  @MinLength(5)
  rejectedReason: string;
}
