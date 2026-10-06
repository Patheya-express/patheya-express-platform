import { IsLatitude, IsLongitude, IsOptional } from 'class-validator';

import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Always-on presence heartbeat (2026-09-16 follow-up) — same optional-location shape as
 * delivery's GoAvailableDto, and for the same reason: POST /presence/online is already called
 * every ~60s by the client to keep Redis presence alive (PresenceService.PRESENCE_TTL_SECONDS is
 * 120s), so it's the natural, already-periodic place to also keep DeliveryPartner.currentLatitude/
 * currentLongitude fresh for as long as a rider stays online — closing the gap where location was
 * previously only ever set once, at the moment of going available. Optional, not required: this
 * endpoint still works with no body exactly as before for any caller that doesn't have a fix yet.
 */
export class MarkOnlineDto {
  @ApiPropertyOptional({
    example: 12.9716,
    description:
      "Delivery partner's current latitude, refreshed on every heartbeat so dispatch's radius filter always has a recent fix while the partner is online.",
  })
  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional({
    example: 77.5946,
    description:
      "Delivery partner's current longitude, refreshed on every heartbeat so dispatch's radius filter always has a recent fix while the partner is online.",
  })
  @IsOptional()
  @IsLongitude()
  longitude?: number;
}
