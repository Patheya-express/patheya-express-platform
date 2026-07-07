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

import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiBody,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
  ApiConflictResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';

import { UserRole, DeliveryPartnerStatus } from '@prisma/client';

import { DeliveryService } from '../services/delivery.service';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';

import { CreateDeliveryPartnerDto } from '../dto/create-delivery-partner.dto';

import { UpdateDeliveryStatusDto } from '../dto/update-delivery-status.dto';

import { DeliveryPartnerResponseDto } from '../dto/delivery-partner-response.dto';

import { GetAdminDeliveryPartnersQueryDto } from '../dto/get-admin-delivery-partners-query.dto';
import { PaginatedAdminDeliveryPartnersResponseDto } from '../dto/paginated-admin-delivery-partners-response.dto';

import { OrderResponseDto } from '../../orders/dto/order-response.dto';
import { UserResponseDto } from '../../users/dto/user-response.dto';

@ApiTags('Delivery')
@ApiBearerAuth('JWT-auth')
@Controller('delivery')
export class DeliveryController {
  constructor(private readonly deliveryService: DeliveryService) {}

  @UseGuards(JwtAuthGuard)
  @Get('me')
  @ApiOperation({
    summary: 'Get my delivery partner profile',
    description:
      'Returns the delivery partner profile for the authenticated user.',
  })
  @ApiOkResponse({
    description: 'Delivery partner profile fetched successfully',
    type: DeliveryPartnerResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Delivery partner not found',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized',
  })
  getMe(
    @CurrentUser()
    user: any,
  ) {
    return this.deliveryService.getMe(user.userId);
  }

  @ApiOperation({
    summary: 'Get delivery partners (admin)',
    description:
      'Returns a paginated, filterable, platform-wide list of delivery partners, including live presence, current assignment, and delivery stats.',
  })
  @ApiOkResponse({
    description: 'Delivery partners retrieved successfully',
    type: PaginatedAdminDeliveryPartnersResponseDto,
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
    description: 'Matches partner name/email/phone or vehicle number',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: DeliveryPartnerStatus,
  })
  @ApiQuery({
    name: 'verified',
    required: false,
    type: Boolean,
    description: 'true = verified only, false = unverified only, omitted = all',
  })
  @ApiQuery({
    name: 'availability',
    required: false,
    type: Boolean,
    description: 'true = AVAILABLE only, false = anything else',
  })
  @ApiQuery({
    name: 'online',
    required: false,
    type: Boolean,
    description: 'Live Redis presence — distinct from `status`',
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
    query: GetAdminDeliveryPartnersQueryDto,
  ) {
    return this.deliveryService.getAllForAdmin(query);
  }

  @UseGuards(JwtAuthGuard)
  @Post('onboard')
  @ApiOperation({
    summary: 'Onboard delivery partner',
    description: 'Register the authenticated user as a delivery partner.',
  })
  @ApiBody({
    type: CreateDeliveryPartnerDto,
  })
  @ApiCreatedResponse({
    description: 'Delivery partner onboarded successfully',
    type: DeliveryPartnerResponseDto,
  })
  @ApiConflictResponse({
    description: 'Delivery partner already exists',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized',
  })
  onboardPartner(
    @CurrentUser()
    user: any,

    @Body()
    dto: CreateDeliveryPartnerDto,
  ) {
    return this.deliveryService.onboardPartner(
      user.userId,

      dto,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Patch('available')
  @ApiOperation({
    summary: 'Set delivery partner available',
  })
  @ApiOkResponse({
    description: 'Partner is now available',
    type: DeliveryPartnerResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized',
  })
  goAvailable(
    @CurrentUser()
    user: any,
  ) {
    return this.deliveryService.goAvailable(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('offline')
  @ApiOperation({
    summary: 'Set delivery partner offline',
  })
  @ApiOkResponse({
    description: 'Partner is now offline',
    type: DeliveryPartnerResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized',
  })
  goOffline(
    @CurrentUser()
    user: any,
  ) {
    return this.deliveryService.goOffline(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('orders')
  @ApiOperation({
    summary: 'Get assigned orders',
    description:
      'Returns all orders assigned to the authenticated delivery partner.',
  })
  @ApiOkResponse({
    description: 'Assigned orders fetched successfully',
    type: OrderResponseDto,
    isArray: true,
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized',
  })
  getAssignedOrders(
    @CurrentUser()
    user: any,
  ) {
    return this.deliveryService.getAssignedOrders(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('orders/:orderId/status')
  @ApiOperation({
    summary: 'Update delivery status',
    description: 'Update delivery progress for an assigned order.',
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
    description: 'Delivery status updated successfully',
    type: OrderResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid status transition',
  })
  @ApiNotFoundResponse({
    description: 'Order not found',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized',
  })
  updateDeliveryStatus(
    @CurrentUser()
    user: any,

    @Param('orderId')
    orderId: string,

    @Body()
    dto: UpdateDeliveryStatusDto,
  ) {
    return this.deliveryService.updateDeliveryStatus(
      orderId,

      user.userId,

      dto,
    );
  }

  @ApiOperation({
    summary: 'Approve delivery partner',
    description: 'Sets isVerified to true. There is no separate pending/rejected state — this is a direct boolean set.',
  })
  @ApiParam({
    name: 'id',
  })
  @ApiOkResponse({
    description: 'Delivery partner approved successfully',
    type: DeliveryPartnerResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Delivery partner not found',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Patch(':id/approve')
  approvePartner(
    @Param('id')
    id: string,
  ) {
    return this.deliveryService.approvePartner(id);
  }

  @ApiOperation({
    summary: 'Reject delivery partner',
    description: 'Sets isVerified to false.',
  })
  @ApiParam({
    name: 'id',
  })
  @ApiOkResponse({
    description: 'Delivery partner rejected successfully',
    type: DeliveryPartnerResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Delivery partner not found',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Patch(':id/reject')
  rejectPartner(
    @Param('id')
    id: string,
  ) {
    return this.deliveryService.rejectPartner(id);
  }

  @ApiOperation({
    summary: 'Suspend delivery partner',
    description: 'Operational-level suspension — the partner cannot go available or receive assignments.',
  })
  @ApiParam({
    name: 'id',
  })
  @ApiOkResponse({
    description: 'Delivery partner suspended successfully',
    type: DeliveryPartnerResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Delivery partner is already suspended',
  })
  @ApiNotFoundResponse({
    description: 'Delivery partner not found',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Patch(':id/suspend')
  suspendPartner(
    @Param('id')
    id: string,
  ) {
    return this.deliveryService.suspendPartner(id);
  }

  @ApiOperation({
    summary: 'Restore delivery partner',
    description: 'Restores a suspended partner back to offline.',
  })
  @ApiParam({
    name: 'id',
  })
  @ApiOkResponse({
    description: 'Delivery partner restored successfully',
    type: DeliveryPartnerResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Only suspended partners can be restored',
  })
  @ApiNotFoundResponse({
    description: 'Delivery partner not found',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Patch(':id/restore')
  restorePartner(
    @Param('id')
    id: string,
  ) {
    return this.deliveryService.restorePartner(id);
  }

  @ApiOperation({
    summary: 'Force delivery partner offline',
    description: 'Admin-scoped variant of the partner\'s own go-offline toggle.',
  })
  @ApiParam({
    name: 'id',
  })
  @ApiOkResponse({
    description: 'Delivery partner forced offline successfully',
    type: DeliveryPartnerResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Delivery partner is not currently online',
  })
  @ApiNotFoundResponse({
    description: 'Delivery partner not found',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Patch(':id/force-offline')
  forceOffline(
    @Param('id')
    id: string,
  ) {
    return this.deliveryService.forceOffline(id);
  }

  @ApiOperation({
    summary: 'Block delivery partner',
    description: 'Account-level block via the underlying user record — the partner cannot log in at all.',
  })
  @ApiParam({
    name: 'id',
  })
  @ApiOkResponse({
    description: 'Delivery partner blocked successfully',
    type: UserResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'User is already blocked',
  })
  @ApiNotFoundResponse({
    description: 'Delivery partner not found',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Patch(':id/block')
  blockPartner(
    @Param('id')
    id: string,

    @CurrentUser()
    user: any,
  ) {
    return this.deliveryService.blockPartner(id, user.userId);
  }

  @ApiOperation({
    summary: 'Unblock delivery partner',
    description: 'Restores the underlying user account from blocked (or suspended) back to active.',
  })
  @ApiParam({
    name: 'id',
  })
  @ApiOkResponse({
    description: 'Delivery partner unblocked successfully',
    type: UserResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Only suspended or blocked users can be restored',
  })
  @ApiNotFoundResponse({
    description: 'Delivery partner not found',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Patch(':id/unblock')
  unblockPartner(
    @Param('id')
    id: string,
  ) {
    return this.deliveryService.unblockPartner(id);
  }
}
