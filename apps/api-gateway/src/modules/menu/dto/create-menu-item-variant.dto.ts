import {
    IsBoolean,
    IsNumber,
    IsOptional,
    IsString,
  } from 'class-validator';
  
  export class CreateMenuItemVariantDto {
  
    @IsString()
    name: string;
  
    @IsNumber()
    price: number;
  
    @IsOptional()
    @IsBoolean()
    isDefault?: boolean;
  
  }