import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { DeliveryDocumentType } from '@prisma/client';

import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsOptional, IsString } from 'class-validator';

export class UploadDeliveryDocumentDto {
  @ApiProperty({ enum: DeliveryDocumentType })
  @IsEnum(DeliveryDocumentType)
  documentType: DeliveryDocumentType;

  @ApiPropertyOptional({ example: 'DL-0420110149646' })
  @IsOptional()
  @IsString()
  documentNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  issueDate?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiryDate?: Date;

  @ApiPropertyOptional({
    description:
      'Scope this document to one vehicle (RC/insurance/fitness/pollution/vehicle photo) instead of the partner as a whole.',
  })
  @IsOptional()
  @IsString()
  vehicleId?: string;

  @ApiPropertyOptional({
    description:
      'If replacing an existing document, its id — the old row is marked isLatest=false and this becomes the new version.',
  })
  @IsOptional()
  @IsString()
  previousVersionId?: string;
}
