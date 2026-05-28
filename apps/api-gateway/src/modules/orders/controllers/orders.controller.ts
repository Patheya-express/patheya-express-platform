import {
    Body,
    Controller,
    Get,
    Param,
    Patch,
    Post,
    UseGuards,
  } from '@nestjs/common';
  
  import { OrdersService }
  from '../services/orders.service';
  
  import { JwtAuthGuard }
  from '../../auth/guards/jwt-auth.guard';
  
  import { CurrentUser }
  from '../../auth/decorators/current-user.decorator';
  
  import { CreateOrderDto }
  from '../dto/create-order.dto';
  
  import { UpdateOrderStatusDto }
  from '../dto/update-order-status.dto';
  
  @Controller('orders')
  export class OrdersController {
  
    constructor(
  
      private readonly ordersService:
        OrdersService,
  
    ) {}
  
    @UseGuards(JwtAuthGuard)
  
    @Post()
  
    placeOrder(
  
      @CurrentUser()
      user: any,
  
      @Body()
      dto: CreateOrderDto,
  
    ) {
  
      return this.ordersService
        .placeOrder(
  
          user.userId,
  
          dto,
  
        );
  
    }
  
    @UseGuards(JwtAuthGuard)
  
    @Get('me')
  
    getCustomerOrders(
  
      @CurrentUser()
      user: any,
  
    ) {
  
      return this.ordersService
        .getCustomerOrders(
          user.userId,
        );
  
    }
  
    @UseGuards(JwtAuthGuard)
  
    @Get('restaurant/:restaurantId')
  
    getRestaurantOrders(
  
      @Param('restaurantId')
      restaurantId: string,
  
    ) {
  
      return this.ordersService
        .getRestaurantOrders(
          restaurantId,
        );
  
    }
  
    @UseGuards(JwtAuthGuard)
  
    @Patch(':orderId/status')
  
    updateOrderStatus(
  
      @Param('orderId')
      orderId: string,
  
      @Body()
      dto: UpdateOrderStatusDto,
  
    ) {
  
      return this.ordersService
        .updateOrderStatus(
  
          orderId,
  
          dto,
  
        );
  
    }
  
  }