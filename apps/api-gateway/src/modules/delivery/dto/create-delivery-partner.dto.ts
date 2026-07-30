import { IsEnum, IsOptional, IsString } from 'class-validator';

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { VehicleType } from '@prisma/client';

export class CreateDeliveryPartnerDto {
  @ApiProperty({
    enum: VehicleType,
    example: 'BIKE',
    description: 'Vehicle type used for deliveries',
  })
  @IsEnum(VehicleType)
  vehicleType: VehicleType;

  @ApiProperty({
    example: 'KA01AB1234',
    description: 'Vehicle registration number',
  })
  @IsString()
  vehicleNumber: string;

  @ApiPropertyOptional({
    example: 'DL123456789',
    description: 'Driving license number',
  })
  @IsOptional()
  @IsString()
  licenseNumber?: string;
}
