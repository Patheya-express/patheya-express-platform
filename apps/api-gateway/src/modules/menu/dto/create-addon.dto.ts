import {
    IsInt,
    IsOptional,
    IsString,
  } from 'class-validator';
  
  export class CreateAddonDto {
  
    @IsString()
    name: string;
  
    @IsOptional()
    @IsInt()
    minSelection?: number;
  
    @IsOptional()
    @IsInt()
    maxSelection?: number;
  
  }