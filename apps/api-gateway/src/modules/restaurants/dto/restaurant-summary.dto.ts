import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * The shared, lightweight discovery payload — used by the public restaurant list, the
 * customer home shelves, and any future discovery-shaped surface. Deliberately excludes
 * owner/branch/status detail that only the full RestaurantResponseDto (single-restaurant
 * detail view) needs, keeping list/home payloads small.
 */
export class RestaurantSummaryDto {
  @ApiProperty({
    example: 'c7c1f1e2-6f2d-4f77-a111-123456789abc',
  })
  id: string;

  @ApiProperty({
    example: 'Patheya Express',
  })
  name: string;

  @ApiProperty({
    example: 'patheya-express',
  })
  slug: string;

  @ApiPropertyOptional({
    example: 'https://cdn.patheya.com/logo.png',
  })
  logoUrl?: string;

  @ApiPropertyOptional({
    example: 'https://cdn.patheya.com/banner.png',
  })
  bannerUrl?: string;

  @ApiProperty({
    type: [String],
    example: ['North Indian', 'Chinese'],
  })
  cuisines: string[];

  @ApiPropertyOptional({
    example: 'Bengaluru',
  })
  city?: string;

  @ApiProperty({
    example: 4.3,
  })
  avgRating: number;

  @ApiProperty({
    example: 128,
  })
  ratingCount: number;

  @ApiPropertyOptional({
    example: 15,
  })
  avgPreparationTimeMinutes?: number;

  @ApiPropertyOptional({
    example: 32,
  })
  avgDeliveryTimeMinutes?: number;

  @ApiProperty({
    example: true,
  })
  isOpenNow: boolean;

  @ApiProperty({
    example: false,
  })
  featured: boolean;

  @ApiProperty({
    example: true,
    description:
      "Derived from this restaurant's menu — true if at least one item is marked vegetarian.",
  })
  hasVegOptions: boolean;

  @ApiProperty({
    example: false,
    description:
      "Derived from this restaurant's menu — true if at least one item is marked vegan.",
  })
  hasVeganOptions: boolean;

  @ApiPropertyOptional({
    example: 3.2,
    description:
      'Distance from the requested lat/lng, in kilometers. Only present when the request included coordinates.',
  })
  distanceKm?: number;
}
