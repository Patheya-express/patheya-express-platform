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

  import {
    AssignDeliveryPartnerDto,
  } from '../dto/assign-delivery-partner.dto';
  
  import {
    CancelOrderDto,
  } from '../dto/cancel-order.dto';
  
  import {
    OrderStatus,
  } from '@prisma/client';

  import {
    ApiBearerAuth,
    ApiCreatedResponse,
    ApiOkResponse,
    ApiOperation,
    ApiParam,
    ApiTags,
  } from '@nestjs/swagger';
  
  import {
    OrderResponseDto,
  } from '../dto/order-response.dto';
  
  import {
    OrderStatusHistoryResponseDto,
  } from '../dto/order-status-history-response.dto';


  @ApiTags('Orders')
  @ApiBearerAuth('JWT-auth')
  @Controller('orders')
  export class OrdersController {
  
    constructor(
  
      private readonly ordersService:
        OrdersService,
  
    ) {}
  
    @UseGuards(JwtAuthGuard)
    
    @ApiOperation({
      summary: 'Place a new order',
    })
    
    @ApiCreatedResponse({
      description: 'Order created successfully',
      type: OrderResponseDto,
    })
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
    
    @ApiOperation({
      summary: 'Get customer orders',
    })
    
    @ApiOkResponse({
      description: 'Customer orders retrieved',
      type: OrderResponseDto,
      isArray: true,
    })
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
    
    @ApiOperation({
      summary: 'Get restaurant orders',
    })
    
    @ApiParam({
      name: 'restaurantId',
    })
    
    @ApiOkResponse({
      description: 'Restaurant orders retrieved',
      type: OrderResponseDto,
      isArray: true,
    })
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
    @ApiOperation({
      summary: 'Update order status',
    })
    
    @ApiParam({
      name: 'orderId',
    })
    
    @ApiOkResponse({
      description: 'Order status updated',
      type: OrderResponseDto,
    })
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
    @UseGuards(JwtAuthGuard)
    @ApiOperation({
      summary: 'Get order timeline',
    })
    
    @ApiParam({
      name: 'id',
    })
    
    @ApiOkResponse({
      description: 'Order timeline retrieved',
      type: OrderStatusHistoryResponseDto,
      isArray: true,
    })
    @Get(':id/timeline')

    getOrderTimeline(

      @Param('id')
      orderId: string,

    ) {

      return this.ordersService
        .getOrderTimeline(
          orderId,
        );

    }
    @UseGuards(JwtAuthGuard)

    @Get(':id')
    @ApiOperation({
      summary: 'Get order details',
    })
    
    @ApiParam({
      name: 'id',
    })
    
    @ApiOkResponse({
      description: 'Order retrieved',
      type: OrderResponseDto,
    })
    getOrderById(

      @Param('id')
      orderId: string,

    ) {

      return this.ordersService
        .getOrderById(
          orderId,
        );

    }
    @UseGuards(JwtAuthGuard)
    @ApiOperation({
      summary: 'Accept order',
    })
    
    @ApiParam({
      name: 'id',
    })
    
    @ApiOkResponse({
      description: 'Order accepted',
      type: OrderResponseDto,
    })
    @Post(':id/accept')

    acceptOrder(

      @Param('id')
      orderId: string,

    ) {

      return this.ordersService
        .updateOrderStatus(

          orderId,

          {
            status:
              OrderStatus.CONFIRMED,
          },

        );

    }
    @UseGuards(JwtAuthGuard)
    @ApiOperation({
      summary: 'Reject order',
    })
    
    @ApiParam({
      name: 'id',
    })
    
    @ApiOkResponse({
      description: 'Order rejected',
      type: OrderResponseDto,
    })
    @Post(':id/reject')

    rejectOrder(

      @Param('id')
      orderId: string,

    ) {

      return this.ordersService
        .updateOrderStatus(

          orderId,

          {
            status:
              OrderStatus.CANCELLED,
          },

        );

    }
    @UseGuards(JwtAuthGuard)
    @ApiOperation({
      summary: 'Start preparing order',
    })
    
    @ApiParam({
      name: 'id',
    })
    
    @ApiOkResponse({
      description: 'Order moved to preparing',
      type: OrderResponseDto,
    })
    @Post(':id/prepare')

    prepareOrder(

      @Param('id')
      orderId: string,

    ) {

      return this.ordersService
        .updateOrderStatus(

          orderId,

          {
            status:
              OrderStatus.PREPARING,
          },

        );

    }
    @UseGuards(JwtAuthGuard)
    @ApiOperation({
      summary: 'Mark order ready for pickup',
    })
    
    @ApiParam({
      name: 'id',
    })
    
    @ApiOkResponse({
      description: 'Order ready for pickup',
      type: OrderResponseDto,
    })
    @Post(':id/ready')

    readyOrder(

      @Param('id')
      orderId: string,

    ) {

      return this.ordersService
        .updateOrderStatus(

          orderId,

          {
            status:
              OrderStatus.READY_FOR_PICKUP,
          },

        );

    }
    @UseGuards(JwtAuthGuard)
    @ApiOperation({
      summary: 'Mark order picked up',
    })
    
    @ApiParam({
      name: 'id',
    })
    
    @ApiOkResponse({
      description: 'Order out for delivery',
      type: OrderResponseDto,
    })
    @Post(':id/picked-up')

    pickedUp(

      @Param('id')
      orderId: string,

    ) {

      return this.ordersService
        .updateOrderStatus(

          orderId,

          {
            status:
              OrderStatus.OUT_FOR_DELIVERY,
          },

        );

    }
    @UseGuards(JwtAuthGuard)
    @ApiOperation({
      summary: 'Mark order delivered',
    })
    
    @ApiParam({
      name: 'id',
    })
    
    @ApiOkResponse({
      description: 'Order delivered',
      type: OrderResponseDto,
    })
    @Post(':id/delivered')

    delivered(

      @Param('id')
      orderId: string,

    ) {

      return this.ordersService
        .updateOrderStatus(

          orderId,

          {
            status:
              OrderStatus.DELIVERED,
          },

        );

    }
    @UseGuards(JwtAuthGuard)
    @ApiOperation({
      summary: 'Cancel order',
    })
    
    @ApiParam({
      name: 'id',
    })
    
    @ApiOkResponse({
      description: 'Order cancelled',
      type: OrderResponseDto,
    })
    @Post(':id/cancel')

    cancelOrder(

      @Param('id')
      orderId: string,

    ) {

      return this.ordersService
        .updateOrderStatus(

          orderId,

          {
            status:
              OrderStatus.CANCELLED,
          },

        );

    }
    @UseGuards(JwtAuthGuard)
    @ApiOperation({
      summary: 'Assign delivery partner',
    })
    
    @ApiParam({
      name: 'id',
    })
    
    @ApiOkResponse({
      description: 'Delivery partner assigned',
      type: OrderResponseDto,
    })
    @Post(':id/assign-delivery-partner')

    assignDeliveryPartner(

      @Param('id')
      orderId: string,

      @Body()
      dto: AssignDeliveryPartnerDto,

    ) {

      return this.ordersService
        .assignDeliveryPartner(

          orderId,

          dto.deliveryPartnerId,

        );

    }
  
  }