import {
  IsBoolean,
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { AddressLabel, LocationSource, MapProvider } from '@prisma/client';

export class CreateAddressDto {
  @ApiProperty({ enum: AddressLabel, example: AddressLabel.HOME })
  @IsEnum(AddressLabel)
  label: AddressLabel;

  @ApiPropertyOptional({ example: "Mom's place" })
  @IsOptional()
  @IsString()
  customLabel?: string;

  @ApiProperty({ example: '221B Baker Street' })
  @IsString()
  addressLine1: string;

  @ApiPropertyOptional({ example: 'Near City Mall' })
  @IsOptional()
  @IsString()
  addressLine2?: string;

  @ApiProperty({ example: 'Bengaluru' })
  @IsString()
  city: string;

  @ApiProperty({ example: 'Karnataka' })
  @IsString()
  state: string;

  @ApiProperty({ example: '560001' })
  @IsString()
  postalCode: string;

  @ApiPropertyOptional({ example: 'Opposite the blue gate' })
  @IsOptional()
  @IsString()
  landmark?: string;

  @ApiPropertyOptional({ example: 'Leave with the security guard' })
  @IsOptional()
  @IsString()
  deliveryInstructions?: string;

  @ApiPropertyOptional({ example: 12.9716 })
  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional({ example: 77.5946 })
  @IsOptional()
  @IsLongitude()
  longitude?: number;

  @ApiPropertyOptional({
    example: 12.5,
    description:
      'GPS accuracy radius in meters, as reported by the capturing device/provider.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  accuracy?: number;

  @ApiPropertyOptional({
    description: 'Meters above sea level, if the provider/device reports it.',
  })
  @IsOptional()
  @IsNumber()
  altitude?: number;

  @ApiPropertyOptional({
    description: 'Compass heading in degrees (0-360), if available.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  heading?: number;

  @ApiPropertyOptional({ description: 'Speed in meters/second, if available.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  speed?: number;

  @ApiPropertyOptional({ enum: LocationSource })
  @IsOptional()
  @IsEnum(LocationSource)
  locationSource?: LocationSource;

  @ApiPropertyOptional({ enum: MapProvider })
  @IsOptional()
  @IsEnum(MapProvider)
  provider?: MapProvider;

  @ApiPropertyOptional({
    description:
      "The map provider's own place identifier, e.g. a Google Place ID.",
  })
  @IsOptional()
  @IsString()
  providerPlaceId?: string;

  @ApiPropertyOptional({
    description:
      'Opaque provider-specific payload (e.g. the raw geocoding result) kept for audit/debugging.',
  })
  @IsOptional()
  @IsObject()
  providerMetadata?: Record<string, unknown>;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
