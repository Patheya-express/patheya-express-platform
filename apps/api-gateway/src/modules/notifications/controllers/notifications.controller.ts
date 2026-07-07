import {
  Controller,
  Get,
  Patch,
  Param,
  Post,
  Body,
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
  ApiUnauthorizedResponse,
  ApiNotFoundResponse,
  ApiBadRequestResponse,
} from '@nestjs/swagger';

import { UserRole, NotificationChannel, NotificationStatus, NotificationType } from '@prisma/client';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';

import { NotificationsService } from '../services/notifications.service';

import { RegisterPushTokenDto } from '../dto/register-push-token.dto';

import { NotificationResponseDto } from '../dto/notification-response.dto';

import { PushTokenResponseDto } from '../dto/push-token-response.dto';

import { GetAdminNotificationsQueryDto } from '../dto/get-admin-notifications-query.dto';
import { PaginatedAdminNotificationsResponseDto } from '../dto/paginated-admin-notifications-response.dto';
import { AdminNotificationResponseDto } from '../dto/admin-notification-response.dto';

@ApiTags('Notifications')
@ApiBearerAuth('JWT-auth')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @UseGuards(JwtAuthGuard)
  @Get('me')
  @ApiOperation({
    summary: 'Get my notifications',
    description: 'Returns notifications belonging to the authenticated user.',
  })
  @ApiOkResponse({
    description: 'Notifications fetched successfully',
    type: NotificationResponseDto,
    isArray: true,
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized',
  })
  getMyNotifications(
    @CurrentUser()
    user: any,
  ) {
    return this.notificationsService.getMyNotifications(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/read')
  @ApiOperation({
    summary: 'Mark notification as read',
  })
  @ApiParam({
    name: 'id',
    description: 'Notification ID',
    example: 'clx123abc456',
  })
  @ApiOkResponse({
    description: 'Notification marked as read',
    type: NotificationResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Notification not found',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized',
  })
  markAsRead(
    @Param('id')
    id: string,
  ) {
    return this.notificationsService.markAsRead(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('push-token')
  @ApiOperation({
    summary: 'Register push notification token',
    description: 'Register a device push token for receiving notifications.',
  })
  @ApiBody({
    type: RegisterPushTokenDto,
  })
  @ApiCreatedResponse({
    description: 'Push token registered successfully',
    type: PushTokenResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized',
  })
  registerPushToken(
    @CurrentUser()
    user: any,

    @Body()
    dto: RegisterPushTokenDto,
  ) {
    return this.notificationsService.registerPushToken(
      user.userId,

      dto.token,

      dto.platform,
    );
  }

  @ApiOperation({
    summary: 'Get notifications (admin)',
    description:
      'Returns a paginated, filterable, platform-wide list of notifications, including recipient details and delivery status.',
  })
  @ApiOkResponse({
    description: 'Notifications retrieved successfully',
    type: PaginatedAdminNotificationsResponseDto,
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
    description: 'Matches subject/body text',
  })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: NotificationType,
  })
  @ApiQuery({
    name: 'channel',
    required: false,
    enum: NotificationChannel,
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: NotificationStatus,
  })
  @ApiQuery({
    name: 'recipient',
    required: false,
    description: 'Matches recipient first name, last name, email, or phone',
  })
  @ApiQuery({
    name: 'dateFrom',
    required: false,
  })
  @ApiQuery({
    name: 'dateTo',
    required: false,
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Get('admin')
  getAllForAdmin(
    @Query()
    query: GetAdminNotificationsQueryDto,
  ) {
    return this.notificationsService.getAllForAdmin(query);
  }

  @ApiOperation({
    summary: 'Get notification by ID (admin)',
  })
  @ApiParam({
    name: 'id',
    description: 'Notification ID',
  })
  @ApiOkResponse({
    description: 'Notification retrieved successfully',
    type: AdminNotificationResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Notification not found',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Get('admin/:id')
  getByIdForAdmin(
    @Param('id')
    id: string,
  ) {
    return this.notificationsService.getByIdForAdmin(id);
  }

  @ApiOperation({
    summary: 'Retry a failed notification (admin)',
    description:
      'Re-enqueues delivery for a notification currently in FAILED status. Provider-agnostic — the outcome is resolved by the queue processor, not by this endpoint.',
  })
  @ApiParam({
    name: 'id',
    description: 'Notification ID',
  })
  @ApiOkResponse({
    description: 'Retry enqueued successfully',
    type: AdminNotificationResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Notification not found',
  })
  @ApiBadRequestResponse({
    description: 'Notification is not in FAILED status',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Post('admin/:id/retry')
  retryNotification(
    @Param('id')
    id: string,
  ) {
    return this.notificationsService.retryNotification(id);
  }
}
