import {
  Body,
  Controller,
  Param,
  Post,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';

import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiConflictResponse,
} from '@nestjs/swagger';

import { UserRole } from '@prisma/client';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';

import { AdminDispatchService } from '../services/admin-dispatch.service';

import type { AuthenticatedUser } from '../../../shared/authorization/order-access.util';

import { GetAvailableDeliveryPartnersQueryDto } from '../dto/get-available-delivery-partners-query.dto';
import { PaginatedAvailableDeliveryPartnersResponseDto } from '../dto/paginated-available-delivery-partners-response.dto';
import { AssignOrderToPartnerDto } from '../dto/assign-order-to-partner.dto';
import { DeliveryAssignmentResponseDto } from '../../dispatch/dto/delivery-assignment-response.dto';
import { DispatchDebugInfoResponseDto } from '../dto/dispatch-debug-info-response.dto';

/**
 * Manual dispatch-assignment admin API (Phase 9) — a dedicated controller rather than adding to
 * the existing, already-complete AdminController, so that file's single `GET /admin/dashboard`
 * route stays untouched.
 */
@ApiTags('Admin - Dispatch')
@ApiBearerAuth('JWT-auth')
@Controller('admin')
export class AdminDispatchController {
  constructor(private readonly adminDispatchService: AdminDispatchService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.DISPATCH_MANAGER)
  @Get('delivery-partners/available')
  @ApiOperation({
    summary: 'List available delivery partners for manual assignment',
    description:
      'Search/filter delivery partners (defaults to AVAILABLE + verified only) by name, phone, email, partner ID, status, and vehicle — includes live online presence, current assignment, and last-known location.',
  })
  @ApiOkResponse({
    description: 'Delivery partners fetched successfully',
    type: PaginatedAvailableDeliveryPartnersResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden' })
  getAvailablePartners(
    @Query()
    query: GetAvailableDeliveryPartnersQueryDto,
  ): Promise<PaginatedAvailableDeliveryPartnersResponseDto> {
    return this.adminDispatchService.getAvailablePartners(query);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.DISPATCH_MANAGER)
  @Post('orders/:orderId/assign')
  @ApiOperation({
    summary: 'Manually assign a delivery partner to an order',
    description:
      'SUPER_ADMIN/DISPATCH_MANAGER only. Rejects offline/suspended/unverified partners, orders that already have a partner or an active assignment, and partners already holding another active assignment. Creates a PENDING DeliveryAssignment the partner still explicitly accepts or rejects, exactly like an automatic dispatch offer.',
  })
  @ApiParam({ name: 'orderId' })
  @ApiOkResponse({
    description: 'Assignment created successfully',
    type: DeliveryAssignmentResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden' })
  @ApiNotFoundResponse({ description: 'Order or delivery partner not found' })
  @ApiConflictResponse({
    description:
      'Order already assigned, already has an active assignment, or the partner already has an active assignment elsewhere',
  })
  assignOrderToPartner(
    @Param('orderId')
    orderId: string,

    @Body()
    dto: AssignOrderToPartnerDto,

    @CurrentUser()
    user: AuthenticatedUser,
  ) {
    return this.adminDispatchService.assignOrderToPartner(
      orderId,

      dto,

      user.userId,
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.DISPATCH_MANAGER)
  @Get('orders/:orderId/dispatch-debug')
  @ApiOperation({
    summary: "Debug an order's dispatch state (support/debugging only)",
    description:
      "Enterprise Dispatch Engine Enhancement Phase 3 — a read-only snapshot of an order's dispatch history: current cycle, total attempts, last attempt time, partners who did not accept, and partners currently within their rejection cooldown for this order. Not consumed by any frontend; exists for support engineers.",
  })
  @ApiParam({ name: 'orderId' })
  @ApiOkResponse({
    description: 'Dispatch debug info fetched successfully',
    type: DispatchDebugInfoResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden' })
  getDispatchDebugInfo(
    @Param('orderId')
    orderId: string,
  ): Promise<DispatchDebugInfoResponseDto> {
    return this.adminDispatchService.getDispatchDebugInfo(orderId);
  }
}
