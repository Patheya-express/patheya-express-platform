import {
    IsNumber,
    IsOptional,
    IsString,
  } from 'class-validator';
  
  export class RefundPaymentDto {
  
    @IsString()
    paymentId: string;
  
    @IsNumber()
    amount: number;
  
    @IsOptional()
    @IsString()
    reason?: string;
  
  }