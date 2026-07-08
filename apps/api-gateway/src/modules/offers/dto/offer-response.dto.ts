import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { OfferType } from '@prisma/client';

export class OfferResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({
    example: 'Flat 20% off on your first order',
  })
  title: string;

  @ApiPropertyOptional()
  description?: string;

  @ApiPropertyOptional({
    example: 'https://cdn.patheya.com/offers/welcome-banner.png',
  })
  imageUrl?: string;

  @ApiPropertyOptional({
    description:
      'Deep link the banner navigates to when tapped — e.g. a restaurant page.',
  })
  linkUrl?: string;

  @ApiPropertyOptional({
    enum: OfferType,
  })
  type?: OfferType;

  @ApiPropertyOptional({
    description:
      'Present when the offer is scoped to a specific restaurant rather than platform-wide.',
  })
  restaurantId?: string;

  @ApiPropertyOptional()
  restaurantName?: string;

  @ApiPropertyOptional()
  startsAt?: Date;

  @ApiPropertyOptional({
    description:
      'When set, the offer stops being returned by any customer-facing endpoint after this time.',
  })
  endsAt?: Date;
}
