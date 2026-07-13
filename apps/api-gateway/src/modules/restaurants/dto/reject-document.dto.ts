import { ApiProperty } from '@nestjs/swagger';

import { IsString, MinLength } from 'class-validator';

export class RejectDocumentDto {
  @ApiProperty({
    example: 'GSTIN on the certificate does not match the entered value.',
  })
  @IsString()
  @MinLength(5)
  rejectedReason: string;
}
