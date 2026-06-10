import {
    IsString,
  } from 'class-validator';
  
  export class AssignDeliveryPartnerDto {
  
    @IsString()
    deliveryPartnerId: string;
  
  }