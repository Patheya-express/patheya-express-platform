import {
    IsBoolean,
    IsNumber,
    IsOptional,
    IsString,
  } from 'class-validator';
  
  export class UpdateAddonOptionDto {
  
    @IsOptional()
    @IsString()
    name?: string;
  
    @IsOptional()
    @IsNumber()
    price?: number;
  
    @IsOptional()
    @IsBoolean()
    isAvailable?: boolean;
  
  }