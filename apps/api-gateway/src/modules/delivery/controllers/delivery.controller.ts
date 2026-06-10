import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiBody,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
  ApiConflictResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';

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

@ApiTags('Delivery')
@ApiBearerAuth()
@Controller('delivery')
export class DeliveryController {

  constructor(

    private readonly deliveryService:
      DeliveryService,

  ) {}

  @UseGuards(JwtAuthGuard)

  @Post('onboard')

  @ApiOperation({
    summary: 'Onboard delivery partner',
    description:
      'Register the authenticated user as a delivery partner.',
  })

  @ApiBody({
    type: CreateDeliveryPartnerDto,
  })

  @ApiCreatedResponse({
    description:
      'Delivery partner onboarded successfully',
  })

  @ApiConflictResponse({
    description:
      'Delivery partner already exists',
  })

  @ApiUnauthorizedResponse({
    description:
      'Unauthorized',
  })

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

  @ApiOperation({
    summary:
      'Set delivery partner available',
  })

  @ApiOkResponse({
    description:
      'Partner is now available',
  })

  @ApiUnauthorizedResponse({
    description:
      'Unauthorized',
  })

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

  @ApiOperation({
    summary:
      'Set delivery partner offline',
  })

  @ApiOkResponse({
    description:
      'Partner is now offline',
  })

  @ApiUnauthorizedResponse({
    description:
      'Unauthorized',
  })

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

  @ApiOperation({
    summary:
      'Get assigned orders',
    description:
      'Returns all orders assigned to the authenticated delivery partner.',
  })

  @ApiOkResponse({
    description:
      'Assigned orders fetched successfully',
  })

  @ApiUnauthorizedResponse({
    description:
      'Unauthorized',
  })

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

  @ApiOperation({
    summary:
      'Update delivery status',
    description:
      'Update delivery progress for an assigned order.',
  })

  @ApiParam({
    name: 'orderId',
    description: 'Order ID',
    example: 'clx123abc456',
  })

  @ApiBody({
    type: UpdateDeliveryStatusDto,
  })

  @ApiOkResponse({
    description:
      'Delivery status updated successfully',
  })

  @ApiBadRequestResponse({
    description:
      'Invalid status transition',
  })

  @ApiNotFoundResponse({
    description:
      'Order not found',
  })

  @ApiUnauthorizedResponse({
    description:
      'Unauthorized',
  })

  updateDeliveryStatus(

    @CurrentUser()
    user: any,
  
    @Param('orderId')
    orderId: string,
  
    @Body()
    dto: UpdateDeliveryStatusDto,
  
  ) {
  
    return this.deliveryService
      .updateDeliveryStatus(
  
        orderId,
  
        user.userId,
  
        dto,
  
      );
  
  }

}