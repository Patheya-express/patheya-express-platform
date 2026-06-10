import {
    IsBoolean,
  } from 'class-validator';
  
  export class ToggleMenuItemAvailabilityDto {
  
    @IsBoolean()
    isAvailable: boolean;
  
  }