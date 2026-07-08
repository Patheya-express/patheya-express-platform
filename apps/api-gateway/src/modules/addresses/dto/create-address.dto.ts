import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { AddressLabel } from '@prisma/client';

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
  @IsNumber()
  latitude?: number;

  @ApiPropertyOptional({ example: 77.5946 })
  @IsOptional()
  @IsNumber()
  longitude?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
