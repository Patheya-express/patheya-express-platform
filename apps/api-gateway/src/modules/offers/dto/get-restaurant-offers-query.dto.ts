import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

import { Transform, Type } from 'class-transformer';

import { ApiPropertyOptional } from '@nestjs/swagger';

/** Query params for the restaurant-owner "manage my offers" listing — unlike the public
 *  /offers/restaurants/:restaurantId endpoint, this returns every offer regardless of active
 *  window, optionally filtered by `isActive`, since the whole point of this view is to also see
 *  paused/expired offers. */
export class GetRestaurantOffersQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @ApiPropertyOptional({
    description:
      'Filter to only enabled or only disabled offers. Omit for both.',
  })
  @IsOptional()
  // `@Type(() => Boolean)` would coerce the query string via the global `Boolean()` function,
  // where `Boolean('false')` is `true` (any non-empty string is truthy) — this reads the literal
  // string instead so `?isActive=false` actually means false.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value === 'true' : value,
  )
  @IsBoolean()
  isActive?: boolean;
}
