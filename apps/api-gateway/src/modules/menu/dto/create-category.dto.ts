import {
    IsOptional,
    IsString,
  } from 'class-validator';
  
  export class CreateCategoryDto {
  
    @IsString()
  
    restaurantId: string;
  
    @IsString()
  
    name: string;
  
    @IsOptional()
  
    @IsString()
  
    description?: string;
  
  }