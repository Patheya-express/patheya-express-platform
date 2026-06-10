import {
    Body,
    Controller,
    Get,
    Param,
    Post,
    UseGuards,
  } from '@nestjs/common';
  
  import { JwtAuthGuard }
  from '../../auth/guards/jwt-auth.guard';
  
  import { TrackingService }
  from '../services/tracking.service';
  
  import { UpdateLocationDto }
  from '../dto/tracking-location.dto';
  
  @Controller('tracking')
  export class TrackingController {
  
    constructor(
  
      private readonly trackingService:
        TrackingService,
  
    ) {}
  
    @UseGuards(JwtAuthGuard)
    @Post('location')
  
    updateLocation(
  
      @Body()
      dto: UpdateLocationDto,
  
    ) {
  
      return this.trackingService
        .updateLocation(
  
          dto.orderId,
  
          dto.latitude,
  
          dto.longitude,
  
        );
  
    }
  
    @UseGuards(JwtAuthGuard)
    @Get('order/:orderId')
  
    getOrderLocation(
  
      @Param('orderId')
      orderId: string,
  
    ) {
  
      return this.trackingService
        .getOrderLocation(
          orderId,
        );
  
    }
  
  }