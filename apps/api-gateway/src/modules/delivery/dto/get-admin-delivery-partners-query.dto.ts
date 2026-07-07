import { IsBoolean, IsBooleanString, IsDateString, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

import { Transform, Type } from 'class-transformer';

import { DeliveryPartnerStatus } from '@prisma/client';

/** Converts the raw HTTP query string ("true"/"false") into an actual boolean once, at the DTO boundary. */
function toBoolean({ value }: { value: unknown }): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

export class GetAdminDeliveryPartnersQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(DeliveryPartnerStatus)
  status?: DeliveryPartnerStatus;

  @IsOptional()
  @IsBooleanString()
  availability?: string;

  @IsOptional()
  @IsBooleanString()
  online?: string;

  /** null/undefined = all, true = verified only, false = unverified only. */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  verified?: boolean;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
