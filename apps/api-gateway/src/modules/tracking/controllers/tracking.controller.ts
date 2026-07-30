import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';

import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiBody,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';

import { TrackingService } from '../services/tracking.service';

import { UpdateLocationDto } from '../dto/tracking-location.dto';
import { OrderLocationResponseDto } from '../dto/order-location-response.dto';

@ApiTags('Tracking')
@ApiBearerAuth('JWT-auth')
@Controller('tracking')
export class TrackingController {
  constructor(private readonly trackingService: TrackingService) {}

  @UseGuards(JwtAuthGuard)
  @Post('location')
  @ApiOperation({
    summary: 'Update delivery location',
    description:
      "Update live GPS location for an order delivery. Restricted to the order's assigned delivery partner (or an admin).",
  })
  @ApiBody({
    type: UpdateLocationDto,
  })
  @ApiOkResponse({
    description: 'Location updated successfully',
    type: OrderLocationResponseDto,
  })
  @ApiForbiddenResponse({
    description: "Caller is not the order's assigned delivery partner",
  })
  @ApiNotFoundResponse({
    description: 'Order not found',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized',
  })
  updateLocation(
    @CurrentUser()
    user: any,

    @Body()
    dto: UpdateLocationDto,
  ) {
    return this.trackingService.updateLocation(
      dto.orderId,

      dto.latitude,

      dto.longitude,

      user,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('order/:orderId')
  @ApiOperation({
    summary: 'Get current order location',
    description:
      "Retrieve the latest tracked location and ETA for an order. Restricted to the order's customer, assigned delivery partner, restaurant owner/manager, or an admin.",
  })
  @ApiParam({
    name: 'orderId',
    description: 'Order ID',
    example: 'clx123abc456',
  })
  @ApiOkResponse({
    description: 'Current location fetched successfully',
    type: OrderLocationResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Tracking information not found',
  })
  @ApiForbiddenResponse({
    description: 'Caller does not have access to this order',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized',
  })
  getOrderLocation(
    @CurrentUser()
    user: any,

    @Param('orderId')
    orderId: string,
  ) {
    return this.trackingService.getOrderLocation(orderId, user);
  }
}
