import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

import { Transform, Type } from 'class-transformer';

import { ApiPropertyOptional } from '@nestjs/swagger';

/** Query params for the restaurant-owner "manage my reviews" listing — unlike the public
 *  GET /restaurants/:id/reviews endpoint, this supports filtering by rating, date range, and
 *  whether a reply has been posted yet. */
export class GetRestaurantReviewsQueryDto {
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
    description: 'Filter to a single star rating (1-5).',
    minimum: 1,
    maximum: 5,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @ApiPropertyOptional({
    description: 'Only reviews created on or after this date.',
  })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({
    description: 'Only reviews created on or before this date.',
  })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({
    description:
      'Filter to only reviews that have (or have not) been replied to. Omit for both.',
  })
  @IsOptional()
  // `@Type(() => Boolean)` would coerce via the global `Boolean()` function, where
  // `Boolean('false')` is `true` (any non-empty string is truthy) — read the literal string
  // instead so `?hasReply=false` actually means false. (Same fix as GetRestaurantOffersQueryDto.)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value === 'true' : value,
  )
  @IsBoolean()
  hasReply?: boolean;
}
