import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { FuelType, VehicleType } from '@prisma/client';

import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class CreateVehicleDto {
  @ApiProperty({ enum: VehicleType })
  @IsEnum(VehicleType)
  vehicleType: VehicleType;

  @ApiProperty({ example: 'KA01AB1234' })
  @IsString()
  // Rejects blank values only — no registration-number format rule exists in the platform.
  @Matches(/\S/, { message: 'Registration number is required' })
  registrationNumber: string;

  @ApiPropertyOptional({ example: 'Honda' })
  @IsOptional()
  @IsString()
  brand?: string;

  @ApiPropertyOptional({ example: 'Activa 6G' })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional({ example: 2022 })
  @IsOptional()
  @IsInt()
  @Min(1980)
  @Max(2100)
  year?: number;

  @ApiPropertyOptional({ enum: FuelType })
  @IsOptional()
  @IsEnum(FuelType)
  fuelType?: FuelType;

  @ApiPropertyOptional({ example: 'Black' })
  @IsOptional()
  @IsString()
  color?: string;

  @ApiPropertyOptional({
    example: false,
    description:
      'The first vehicle a partner registers is always primary regardless of this flag.',
  })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
