import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';

import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiBody,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

import { TrackingService } from '../services/tracking.service';

import { UpdateLocationDto } from '../dto/tracking-location.dto';

@ApiTags('Tracking')
@ApiBearerAuth('JWT-auth')
@Controller('tracking')
export class TrackingController {
  constructor(private readonly trackingService: TrackingService) {}

  @UseGuards(JwtAuthGuard)
  @Post('location')
  @ApiOperation({
    summary: 'Update delivery location',
    description: 'Update live GPS location for an order delivery.',
  })
  @ApiBody({
    type: UpdateLocationDto,
  })
  @ApiOkResponse({
    description: 'Location updated successfully',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized',
  })
  updateLocation(
    @Body()
    dto: UpdateLocationDto,
  ) {
    return this.trackingService.updateLocation(
      dto.orderId,

      dto.latitude,

      dto.longitude,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('order/:orderId')
  @ApiOperation({
    summary: 'Get current order location',
    description: 'Retrieve the latest tracked location for an order.',
  })
  @ApiParam({
    name: 'orderId',
    description: 'Order ID',
    example: 'clx123abc456',
  })
  @ApiOkResponse({
    description: 'Current location fetched successfully',
  })
  @ApiNotFoundResponse({
    description: 'Tracking information not found',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized',
  })
  getOrderLocation(
    @Param('orderId')
    orderId: string,
  ) {
    return this.trackingService.getOrderLocation(orderId);
  }
}
