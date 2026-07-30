import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { OrdersService } from '../services/orders.service';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';

import { CreateOrderDto } from '../dto/create-order.dto';

import { UpdateOrderStatusDto } from '../dto/update-order-status.dto';

import { AssignDeliveryPartnerDto } from '../dto/assign-delivery-partner.dto';

import { CancelOrderDto } from '../dto/cancel-order.dto';

import { GetAdminOrdersQueryDto } from '../dto/get-admin-orders-query.dto';
import { GetCustomerOrdersQueryDto } from '../dto/get-customer-orders-query.dto';
import { PaginatedOrdersResponseDto } from '../dto/paginated-orders-response.dto';
import { ForceCompleteOrderDto } from '../dto/force-complete-order.dto';
import { RefundOrderDto } from '../dto/refund-order.dto';

import { OrderStatus, UserRole } from '@prisma/client';

import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiBody,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { OrderResponseDto } from '../dto/order-response.dto';

import { OrderStatusHistoryResponseDto } from '../dto/order-status-history-response.dto';
import { PaginatedAdminOrdersResponseDto } from '../dto/paginated-admin-orders-response.dto';
import { RestaurantDashboardResponseDto } from '../dto/restaurant-dashboard-response.dto';

@ApiTags('Orders')
@ApiBearerAuth('JWT-auth')
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

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
    return this.ordersService.placeOrder(
      user.userId,

      dto,
    );
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Get my order history',
    description:
      "Returns a paginated, filterable, searchable list of the current customer's own orders.",
  })
  @ApiOkResponse({
    description: 'Customer orders retrieved',
    type: PaginatedOrdersResponseDto,
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({
    name: 'search',
    required: false,
    description: 'Matches order number or restaurant name',
  })
  @ApiQuery({ name: 'status', required: false, enum: OrderStatus })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  @Get('me')
  getCustomerOrders(
    @CurrentUser()
    user: any,

    @Query()
    query: GetCustomerOrdersQueryDto,
  ) {
    return this.ordersService.getCustomerOrders(user.userId, query);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Get restaurant orders',
    description:
      "Restricted to the restaurant's own owner/manager, or an admin.",
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
    @CurrentUser()
    user: any,

    @Param('restaurantId')
    restaurantId: string,
  ) {
    return this.ordersService.getRestaurantOrders(restaurantId, user);
  }

  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Get restaurant dashboard metrics',
    description:
      "Restricted to the restaurant's own owner/manager, or an admin. Every metric is " +
      'computed server-side; the frontend only renders this response.',
  })
  @ApiParam({ name: 'restaurantId' })
  @ApiQuery({
    name: 'branchId',
    required: false,
    description: 'Scope every metric to a single branch.',
  })
  @ApiOkResponse({
    description: 'Dashboard metrics retrieved',
    type: RestaurantDashboardResponseDto,
  })
  @Get('restaurant/:restaurantId/dashboard')
  getRestaurantDashboard(
    @CurrentUser()
    user: any,

    @Param('restaurantId')
    restaurantId: string,

    @Query('branchId')
    branchId?: string,
  ) {
    return this.ordersService.getRestaurantDashboard(
      restaurantId,
      user,
      branchId,
    );
  }

  @ApiOperation({
    summary: 'Get orders (admin)',
    description:
      'Returns a paginated, filterable, platform-wide list of orders, including customer, restaurant, delivery partner, and payment summaries.',
  })
  @ApiOkResponse({
    description: 'Orders retrieved successfully',
    type: PaginatedAdminOrdersResponseDto,
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
    description:
      'Matches order number, customer name/email, or restaurant name',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: OrderStatus,
  })
  @ApiQuery({
    name: 'restaurantId',
    required: false,
  })
  @ApiQuery({
    name: 'customerId',
    required: false,
  })
  @ApiQuery({
    name: 'deliveryPartnerId',
    required: false,
  })
  @ApiQuery({
    name: 'dateFrom',
    required: false,
    description: 'ISO date — filters orders placed on or after this date',
  })
  @ApiQuery({
    name: 'dateTo',
    required: false,
    description: 'ISO date — filters orders placed on or before this date',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Get('admin')
  getAllForAdmin(
    @Query()
    query: GetAdminOrdersQueryDto,
  ) {
    return this.ordersService.getAllForAdmin(query);
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
    @CurrentUser()
    user: any,

    @Param('orderId')
    orderId: string,

    @Body()
    dto: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateOrderStatus(
      orderId,

      dto,

      user,
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
    @CurrentUser()
    user: any,

    @Param('id')
    orderId: string,
  ) {
    return this.ordersService.getOrderTimeline(orderId, user);
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
    @CurrentUser()
    user: any,

    @Param('id')
    orderId: string,
  ) {
    return this.ordersService.getOrderById(orderId, user);
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
    @CurrentUser()
    user: any,

    @Param('id')
    orderId: string,
  ) {
    return this.ordersService.updateOrderStatus(
      orderId,

      {
        status: OrderStatus.CONFIRMED,
      },

      user,
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
    @CurrentUser()
    user: any,

    @Param('id')
    orderId: string,
  ) {
    return this.ordersService.updateOrderStatus(
      orderId,

      {
        status: OrderStatus.CANCELLED,
      },

      user,
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
    @CurrentUser()
    user: any,

    @Param('id')
    orderId: string,
  ) {
    return this.ordersService.updateOrderStatus(
      orderId,

      {
        status: OrderStatus.PREPARING,
      },

      user,
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
    @CurrentUser()
    user: any,

    @Param('id')
    orderId: string,
  ) {
    return this.ordersService.updateOrderStatus(
      orderId,

      {
        status: OrderStatus.READY_FOR_PICKUP,
      },

      user,
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
    @CurrentUser()
    user: any,

    @Param('id')
    orderId: string,
  ) {
    return this.ordersService.updateOrderStatus(
      orderId,

      {
        status: OrderStatus.OUT_FOR_DELIVERY,
      },

      user,
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
    @CurrentUser()
    user: any,

    @Param('id')
    orderId: string,
  ) {
    return this.ordersService.updateOrderStatus(
      orderId,

      {
        status: OrderStatus.DELIVERED,
      },

      user,
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
  @ApiBody({ type: CancelOrderDto, required: false })
  @Post(':id/cancel')
  cancelOrder(
    @CurrentUser()
    user: any,

    @Param('id')
    orderId: string,

    @Body()
    dto: CancelOrderDto,
  ) {
    return this.ordersService.updateOrderStatus(
      orderId,

      {
        status: OrderStatus.CANCELLED,
        reason: dto.reason,
      },

      user,
    );
  }
  @ApiOperation({
    summary: 'Assign or reassign delivery partner',
    description:
      'Admin-only. Validates the target user is a real delivery partner and the order is not in a terminal status.',
  })
  @ApiParam({
    name: 'id',
  })
  @ApiOkResponse({
    description: 'Delivery partner assigned',
    type: OrderResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Order is in a terminal status and cannot be reassigned',
  })
  @ApiNotFoundResponse({
    description: 'Order or delivery partner not found',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Post(':id/assign-delivery-partner')
  assignDeliveryPartner(
    @Param('id')
    orderId: string,

    @Body()
    dto: AssignDeliveryPartnerDto,
  ) {
    return this.ordersService.assignDeliveryPartner(
      orderId,

      dto.deliveryPartnerId,
    );
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Cancel order (admin)',
    description:
      'Admin-only. Cancels an order from any non-terminal status, unlike the customer/restaurant-facing cancel endpoint.',
  })
  @ApiParam({
    name: 'id',
  })
  @ApiOkResponse({
    description: 'Order cancelled successfully',
    type: OrderResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Order is already in a terminal status',
  })
  @ApiNotFoundResponse({
    description: 'Order not found',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Patch(':id/admin-cancel')
  adminCancelOrder(
    @Param('id')
    id: string,

    @Body()
    dto: CancelOrderDto,
  ) {
    return this.ordersService.adminCancelOrder(id, dto);
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Force complete order',
    description:
      'Admin-only. Marks an order delivered directly, skipping the normal status pipeline.',
  })
  @ApiParam({
    name: 'id',
  })
  @ApiOkResponse({
    description: 'Order marked delivered',
    type: OrderResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Order is already in a terminal status',
  })
  @ApiNotFoundResponse({
    description: 'Order not found',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Patch(':id/force-complete')
  forceCompleteOrder(
    @Param('id')
    id: string,

    @Body()
    dto: ForceCompleteOrderDto,
  ) {
    return this.ordersService.forceCompleteOrder(id, dto);
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Refund order',
    description:
      "Admin-only. Resolves the order's active payment and refunds it via the payment provider.",
  })
  @ApiParam({
    name: 'id',
  })
  @ApiOkResponse({
    description: 'Order refunded successfully',
    type: OrderResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Order has no successful payment to refund',
  })
  @ApiNotFoundResponse({
    description: 'Order not found',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Patch(':id/refund')
  refundOrder(
    @CurrentUser()
    user: any,

    @Param('id')
    id: string,

    @Body()
    dto: RefundOrderDto,
  ) {
    return this.ordersService.refundOrder(id, dto, user.userId);
  }
}
