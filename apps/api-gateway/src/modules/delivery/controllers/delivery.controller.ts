import {
    Body,
    Controller,
    Get,
    Param,
    Patch,
    Post,
    UseGuards,
  } from '@nestjs/common';
  
  import { DeliveryService }
  from '../services/delivery.service';
  
  import { JwtAuthGuard }
  from '../../auth/guards/jwt-auth.guard';
  
  import { CurrentUser }
  from '../../auth/decorators/current-user.decorator';
  
  import { CreateDeliveryPartnerDto }
  from '../dto/create-delivery-partner.dto';
  
  import { UpdateDeliveryStatusDto }
  from '../dto/update-delivery-status.dto';
  
  @Controller('delivery')
  export class DeliveryController {
  
    constructor(
  
      private readonly deliveryService:
        DeliveryService,
  
    ) {}
  
    @UseGuards(JwtAuthGuard)
  
    @Post('onboard')
  
    onboardPartner(
  
      @CurrentUser()
      user: any,
  
      @Body()
      dto: CreateDeliveryPartnerDto,
  
    ) {
  
      return this.deliveryService
        .onboardPartner(
  
          user.userId,
  
          dto,
  
        );
  
    }
  
    @UseGuards(JwtAuthGuard)
  
    @Patch('available')
  
    goAvailable(
  
      @CurrentUser()
      user: any,
  
    ) {
  
      return this.deliveryService
        .goAvailable(
          user.userId,
        );
  
    }
  
    @UseGuards(JwtAuthGuard)
  
    @Patch('offline')
  
    goOffline(
  
      @CurrentUser()
      user: any,
  
    ) {
  
      return this.deliveryService
        .goOffline(
          user.userId,
        );
  
    }
  
    @UseGuards(JwtAuthGuard)
  
    @Get('orders')
  
    getAssignedOrders(
  
      @CurrentUser()
      user: any,
  
    ) {
  
      return this.deliveryService
        .getAssignedOrders(
          user.userId,
        );
  
    }
  
    @UseGuards(JwtAuthGuard)
  
    @Patch('orders/:orderId/status')
  
    updateDeliveryStatus(
  
      @Param('orderId')
      orderId: string,
  
      @Body()
      dto: UpdateDeliveryStatusDto,
  
    ) {
  
      return this.deliveryService
        .updateDeliveryStatus(
  
          orderId,
  
          dto,
  
        );
  
    }
  
  }