import { ApiProperty } from '@nestjs/swagger';

import { IsString, MinLength } from 'class-validator';

export class RejectVerificationDto {
  @ApiProperty({
    example: 'FSSAI license expired — please upload a renewed certificate.',
  })
  @IsString()
  @MinLength(5)
  rejectedReason: string;
}
