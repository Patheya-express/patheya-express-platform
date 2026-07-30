import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { RestaurantDocumentType } from '@prisma/client';

import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsOptional, IsString } from 'class-validator';

export class UploadDocumentDto {
  @ApiProperty({ enum: RestaurantDocumentType })
  @IsEnum(RestaurantDocumentType)
  documentType: RestaurantDocumentType;

  @ApiPropertyOptional({ example: '29ABCDE1234F1Z5' })
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
      'Scope this document to one branch instead of the whole restaurant.',
  })
  @IsOptional()
  @IsString()
  branchId?: string;

  @ApiPropertyOptional({
    description:
      'If replacing an existing document, its id — the old row is marked isLatest=false and this becomes the new version.',
  })
  @IsOptional()
  @IsString()
  previousVersionId?: string;
}
