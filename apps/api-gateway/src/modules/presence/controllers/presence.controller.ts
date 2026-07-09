import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';

import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiOkResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { UserRole } from '@prisma/client';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';

import { PresenceService } from '../services/presence.service';

@ApiTags('Presence')
@ApiBearerAuth('JWT-auth')
@Controller('presence')
export class PresenceController {
  constructor(private readonly presenceService: PresenceService) {}

  @UseGuards(JwtAuthGuard)
  @Post('online')
  @ApiOperation({
    summary: 'Mark delivery partner online',
    description:
      'Marks the authenticated delivery partner as online and available for realtime presence tracking.',
  })
  @ApiOkResponse({
    description: 'Partner marked online successfully',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized',
  })
  async markOnline(
    @CurrentUser()
    user: any,
  ) {
    return this.presenceService.markOnline(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('offline')
  @ApiOperation({
    summary: 'Mark delivery partner offline',
    description: 'Marks the authenticated delivery partner as offline.',
  })
  @ApiOkResponse({
    description: 'Partner marked offline successfully',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized',
  })
  async markOffline(
    @CurrentUser()
    user: any,
  ) {
    return this.presenceService.markOffline(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':partnerId')
  @ApiOperation({
    summary: 'Get delivery partner presence status',
    description:
      'Returns online/offline status and last seen information for a delivery partner.',
  })
  @ApiParam({
    name: 'partnerId',
    description: 'Delivery partner ID',
    example: 'clx123abc456',
  })
  @ApiOkResponse({
    description: 'Presence status fetched successfully',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized',
  })
  async getStatus(
    @Param('partnerId')
    partnerId: string,
  ) {
    return this.presenceService.getStatus(partnerId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPPORT_AGENT, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Post('agent/online')
  @ApiOperation({
    summary: 'Mark support agent online',
    description:
      'Marks the authenticated support agent online for the live-chat admin console.',
  })
  @ApiOkResponse({ description: 'Agent marked online successfully' })
  async markAgentOnline(
    @CurrentUser()
    user: any,
  ) {
    return this.presenceService.markAgentOnline(user.userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPPORT_AGENT, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Post('agent/offline')
  @ApiOperation({ summary: 'Mark support agent offline' })
  @ApiOkResponse({ description: 'Agent marked offline successfully' })
  async markAgentOffline(
    @CurrentUser()
    user: any,
  ) {
    return this.presenceService.markAgentOffline(user.userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPPORT_AGENT, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Get('agents/online')
  @ApiOperation({ summary: 'List currently online support agent IDs' })
  @ApiOkResponse({ description: 'Online agent IDs retrieved successfully' })
  async listOnlineAgents() {
    return this.presenceService.listOnlineAgentIds();
  }
}
