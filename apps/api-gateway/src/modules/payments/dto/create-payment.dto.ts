import {
    IsNumber,
    IsString,
  } from 'class-validator';
  
  export class CreatePaymentDto {
  
    @IsString()
    orderId: string;
  
    @IsNumber()
    amount: number;
  
  }