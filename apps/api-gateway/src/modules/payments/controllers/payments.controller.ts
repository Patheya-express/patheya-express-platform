import {
    Body,
    Controller,
    Post,
    UseGuards,
  } from '@nestjs/common';
  
  import { JwtAuthGuard }
  from '../../auth/guards/jwt-auth.guard';
  
  import { PaymentsService }
  from '../services/payments.service';
  
  import { CreatePaymentDto }
  from '../dto/create-payment.dto';
  
  import { VerifyPaymentDto }
  from '../dto/verify-payment.dto';
  
  import { RefundPaymentDto }
  from '../dto/refund-payment.dto';
  
  @Controller('payments')
  export class PaymentsController {
  
    constructor(
  
      private readonly paymentsService:
        PaymentsService,
  
    ) {}
  
    @UseGuards(JwtAuthGuard)
  
    @Post('create')
  
    createPayment(
  
      @Body()
      dto: CreatePaymentDto,
  
    ) {
  
      return this.paymentsService
        .createPayment(
  
          dto.orderId,
  
          dto.amount,
  
        );
  
    }
  
    @Post('verify')
  
    verifyPayment(
  
      @Body()
      dto: VerifyPaymentDto,
  
    ) {
  
      return this.paymentsService
        .verifyPayment(dto);
  
    }
  
    @UseGuards(JwtAuthGuard)
  
    @Post('refund')
  
    refundPayment(
  
      @Body()
      dto: RefundPaymentDto,
  
    ) {
  
      return this.paymentsService
        .refundPayment(
  
          dto.paymentId,
  
          dto.amount,
  
          dto.reason,
  
        );
  
    }
  
    @Post('webhook')
  
    processWebhook(
  
      @Body()
      payload: any,
  
    ) {
  
      return this.paymentsService
        .processWebhook(
          payload,
        );
  
    }
  
  }