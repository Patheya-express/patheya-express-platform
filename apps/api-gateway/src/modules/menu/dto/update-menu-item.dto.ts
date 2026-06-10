import {
    IsBoolean,
    IsNumber,
    IsOptional,
    IsString,
  } from 'class-validator';
  
  export class UpdateMenuItemDto {
  
    @IsOptional()
    @IsString()
    name?: string;
  
    @IsOptional()
    @IsString()
    description?: string;
  
    @IsOptional()
    @IsNumber()
    basePrice?: number;
  
    @IsOptional()
    @IsBoolean()
    isVegetarian?: boolean;
  
    @IsOptional()
    @IsBoolean()
    isVegan?: boolean;
  
  }