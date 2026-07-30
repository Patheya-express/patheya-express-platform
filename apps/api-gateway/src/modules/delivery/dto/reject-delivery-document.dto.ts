import { ApiProperty } from '@nestjs/swagger';

import { IsString, MinLength } from 'class-validator';

export class RejectDeliveryDocumentDto {
  @ApiProperty({
    example: 'The uploaded Aadhaar photo is blurry — please re-upload.',
  })
  @IsString()
  @MinLength(5)
  rejectedReason: string;
}
