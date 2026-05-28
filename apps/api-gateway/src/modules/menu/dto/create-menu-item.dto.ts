import {
    IsBoolean,
    IsNumber,
    IsOptional,
    IsString,
  } from 'class-validator';
  
  export class CreateMenuItemDto {
  
    @IsString()
  
    categoryId: string;
  
    @IsString()
  
    name: string;
  
    @IsOptional()
  
    @IsString()
  
    description?: string;
  
    @IsNumber()
  
    basePrice: number;
  
    @IsOptional()
  
    @IsBoolean()
  
    isVegetarian?: boolean;
  
    @IsOptional()
  
    @IsBoolean()
  
    isVegan?: boolean;
  
  }