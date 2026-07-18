import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { AddressLabel, LocationSource, MapProvider } from '@prisma/client';

export class AddressResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  customerId: string;

  @ApiProperty({ enum: AddressLabel })
  label: AddressLabel;

  @ApiPropertyOptional()
  customLabel?: string;

  @ApiProperty()
  addressLine1: string;

  @ApiPropertyOptional()
  addressLine2?: string;

  @ApiProperty()
  city: string;

  @ApiProperty()
  state: string;

  @ApiProperty()
  postalCode: string;

  @ApiPropertyOptional()
  landmark?: string;

  @ApiPropertyOptional()
  deliveryInstructions?: string;

  @ApiPropertyOptional()
  latitude?: number;

  @ApiPropertyOptional()
  longitude?: number;

  @ApiPropertyOptional()
  accuracy?: number;

  @ApiPropertyOptional()
  altitude?: number;

  @ApiPropertyOptional()
  heading?: number;

  @ApiPropertyOptional()
  speed?: number;

  @ApiPropertyOptional({ enum: LocationSource })
  locationSource?: LocationSource;

  @ApiPropertyOptional({ enum: MapProvider })
  provider?: MapProvider;

  @ApiPropertyOptional()
  providerPlaceId?: string;

  @ApiPropertyOptional()
  providerMetadata?: Record<string, unknown>;

  @ApiProperty()
  verified: boolean;

  @ApiPropertyOptional()
  verifiedAt?: Date;

  @ApiProperty()
  isDefault: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
