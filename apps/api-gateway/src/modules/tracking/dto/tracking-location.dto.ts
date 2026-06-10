import {
    IsLatitude,
    IsLongitude,
    IsString,
  } from 'class-validator';
  
  export class UpdateLocationDto {
  
    @IsString()
    orderId: string;
  
    @IsLatitude()
    latitude: number;
  
    @IsLongitude()
    longitude: number;
  
  }