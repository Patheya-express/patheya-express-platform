import { IsLatitude, IsLongitude, IsOptional } from 'class-validator';

import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Radius dispatch revision (2026-09-16) — going available is the one non-order-scoped moment a
 * delivery partner's client can report where they currently are (the only other location write,
 * TrackingService.updateLocation, requires an already-active assignment — no use to a partner who
 * has never been assigned one yet). Optional, not required: DeliveryService.goAvailable still
 * works with no body exactly as before, so this is purely additive for callers that pass it.
 * Without a reported location, DispatchService's 5km radius filter can never confirm this partner
 * is in range and will not offer them orders — see that filter's own doc comment.
 */
export class GoAvailableDto {
  @ApiPropertyOptional({
    example: 12.9716,
    description:
      "Delivery partner's current latitude, used by dispatch's 5km radius filter to decide which orders they can be offered.",
  })
  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional({
    example: 77.5946,
    description:
      "Delivery partner's current longitude, used by dispatch's 5km radius filter to decide which orders they can be offered.",
  })
  @IsOptional()
  @IsLongitude()
  longitude?: number;
}
