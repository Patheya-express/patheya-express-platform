import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import type { RawBodyRequest } from '@nestjs/common';

import type { Request } from 'express';

import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiQuery,
} from '@nestjs/swagger';

import {
  UserRole,
  TransactionStatus,
  PaymentProvider,
  PaymentMethod,
} from '@prisma/client';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

import { PaymentsService } from '../services/payments.service';

import { CreatePaymentDto } from '../dto/create-payment.dto';

import { VerifyPaymentDto } from '../dto/verify-payment.dto';

import { RefundPaymentDto } from '../dto/refund-payment.dto';

import { CreatePaymentResponseDto } from '../dto/create-payment-response.dto';

import { PaymentResponseDto } from '../dto/payment-response.dto';

import { RazorpayRefundResponseDto } from '../dto/razorpay-refund-response.dto';

import { WebhookAckResponseDto } from '../dto/webhook-ack-response.dto';

import { GetAdminPaymentsQueryDto } from '../dto/get-admin-payments-query.dto';
import { PaginatedAdminPaymentsResponseDto } from '../dto/paginated-admin-payments-response.dto';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Get payments (admin)',
    description:
      'Returns a paginated, filterable, platform-wide list of payments, including order, customer, and refund history.',
  })
  @ApiOkResponse({
    description: 'Payments retrieved successfully',
    type: PaginatedAdminPaymentsResponseDto,
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
  })
  @ApiQuery({
    name: 'search',
    required: false,
    description: 'Matches order number or customer name/email/phone',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: TransactionStatus,
  })
  @ApiQuery({
    name: 'provider',
    required: false,
    enum: PaymentProvider,
  })
  @ApiQuery({
    name: 'method',
    required: false,
    enum: PaymentMethod,
  })
  @ApiQuery({
    name: 'dateFrom',
    required: false,
  })
  @ApiQuery({
    name: 'dateTo',
    required: false,
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Get('admin')
  getAllForAdmin(
    @Query()
    query: GetAdminPaymentsQueryDto,
  ) {
    return this.paymentsService.getAllForAdmin(query);
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Create payment',
    description:
      'Creates a Razorpay order for the given order and returns the pending payment record.',
  })
  @ApiBody({
    type: CreatePaymentDto,
  })
  @ApiCreatedResponse({
    description: 'Payment created successfully',
    type: CreatePaymentResponseDto,
  })
  @UseGuards(JwtAuthGuard)
  @Post('create')
  createPayment(
    @CurrentUser()
    user: any,

    @Body()
    dto: CreatePaymentDto,
  ) {
    return this.paymentsService.createPayment(
      dto.orderId,

      dto.amount,

      user.userId,
    );
  }

  @ApiOperation({
    summary: 'Verify payment',
    description:
      'Verifies the Razorpay payment signature and marks the payment as successful.',
  })
  @ApiBody({
    type: VerifyPaymentDto,
  })
  @ApiOkResponse({
    description: 'Payment verified successfully',
    type: PaymentResponseDto,
  })
  @Post('verify')
  verifyPayment(
    @Body()
    dto: VerifyPaymentDto,
  ) {
    return this.paymentsService.verifyPayment(dto);
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Refund payment',
  })
  @ApiBody({
    type: RefundPaymentDto,
  })
  @ApiOkResponse({
    description: 'Refund processed successfully',
    type: RazorpayRefundResponseDto,
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Post('refund')
  refundPayment(
    @Body()
    dto: RefundPaymentDto,
  ) {
    return this.paymentsService.refundPayment(
      dto.paymentId,

      dto.amount,

      dto.reason,
    );
  }

  @ApiOperation({
    summary: 'Razorpay webhook',
    description:
      'Receives asynchronous payment status events from Razorpay. Payload shape is defined by Razorpay and is not validated against a fixed contract. The request signature is verified against the raw body before processing.',
  })
  @ApiBody({
    description: 'Raw Razorpay webhook event payload',
  })
  @ApiOkResponse({
    description: 'Webhook processed successfully',
    type: WebhookAckResponseDto,
  })
  @Post('webhook')
  processWebhook(
    @Body()
    payload: any,

    @Req()
    req: RawBodyRequest<Request>,

    @Headers('x-razorpay-signature')
    signature: string,
  ) {
    return this.paymentsService.processWebhook(
      payload,
      req.rawBody?.toString('utf8') ?? '',
      signature,
    );
  }
}
