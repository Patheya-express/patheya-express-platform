import {
    IsEnum,
    IsOptional,
    IsString,
  } from 'class-validator';
  
  import {
    VehicleType,
  } from '@prisma/client';
  
  export class CreateDeliveryPartnerDto {
  
    @IsEnum(VehicleType)
  
    vehicleType: VehicleType;
  
    @IsString()
  
    vehicleNumber: string;
  
    @IsOptional()
  
    @IsString()
  
    licenseNumber?: string;
  
  }