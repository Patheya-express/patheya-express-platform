import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

import { Type } from 'class-transformer';

import { DeliveryPartnerStatus, VehicleType } from '@prisma/client';

/**
 * Query params for `GET /admin/delivery-partners/available` (Phase 9 manual-assignment support).
 * `search` matches name/email/phone/vehicle number (same fields DeliveryRepository's existing
 * admin search already covers); `partnerId` is a separate, exact-match lookup since fuzzy-
 * matching a UUID via `contains` isn't meaningful.
 */
export class GetAvailableDeliveryPartnersQueryDto {
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
  @IsString()
  partnerId?: string;

  /** Omitted defaults to AVAILABLE-only (the endpoint's own name/purpose); pass explicitly to
   *  widen the search to any status. */
  @IsOptional()
  @IsEnum(DeliveryPartnerStatus)
  status?: DeliveryPartnerStatus;

  @IsOptional()
  @IsEnum(VehicleType)
  vehicleType?: VehicleType;
}
