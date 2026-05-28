import {
    IsOptional,
    IsString,
  } from 'class-validator';
  
  export class CreateRestaurantDto {
  
    @IsString()
  
    name: string;
  
    @IsString()
  
    slug: string;
  
    @IsOptional()
  
    @IsString()
  
    description?: string;
  
    @IsOptional()
  
    @IsString()
  
    phone?: string;
  
    @IsOptional()
  
    @IsString()
  
    email?: string;
  
  }