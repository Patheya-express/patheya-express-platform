import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import {
  IsBoolean,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateBranchDto {
  @ApiProperty({ example: 'Patheya Express — Koramangala' })
  @IsString()
  name: string;

  @ApiProperty({ example: '123 80 Feet Road' })
  @IsString()
  addressLine1: string;

  @ApiPropertyOptional({ example: 'Near Forum Mall' })
  @IsOptional()
  @IsString()
  addressLine2?: string;

  @ApiPropertyOptional({ example: 'Opposite Koramangala Bus Stand' })
  @IsOptional()
  @IsString()
  landmark?: string;

  @ApiProperty({ example: 'Bengaluru' })
  @IsString()
  city: string;

  @ApiProperty({ example: 'Karnataka' })
  @IsString()
  state: string;

  @ApiProperty({ example: '560095' })
  @IsString()
  postalCode: string;

  @ApiPropertyOptional({ example: 12.9352 })
  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional({ example: 77.6146 })
  @IsOptional()
  @IsLongitude()
  longitude?: number;

  @ApiPropertyOptional({ example: 'Asia/Kolkata' })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiPropertyOptional({
    example: 8,
    description:
      'Simple radius in kilometers — polygon/geofence support is future work.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  deliveryRadiusKm?: number;

  @ApiPropertyOptional({ example: '+919876543210' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 'Branch Manager Name' })
  @IsOptional()
  @IsString()
  emergencyContactName?: string;

  @ApiPropertyOptional({ example: '+919876543299' })
  @IsOptional()
  @IsString()
  emergencyContactPhone?: string;

  @ApiPropertyOptional({
    description:
      'First branch created for a restaurant becomes primary automatically regardless of this flag.',
  })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
