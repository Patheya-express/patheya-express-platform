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

import {
  UserRole,
  NotificationChannel,
  NotificationStatus,
  NotificationType,
} from '@prisma/client';

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
import { GetCustomerNotificationsQueryDto } from '../dto/get-customer-notifications-query.dto';
import { PaginatedNotificationsResponseDto } from '../dto/paginated-notifications-response.dto';
import { UnreadCountResponseDto } from '../dto/unread-count-response.dto';
import { MarkAllReadResponseDto } from '../dto/mark-all-read-response.dto';

@ApiTags('Notifications')
@ApiBearerAuth('JWT-auth')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @UseGuards(JwtAuthGuard)
  @Get('me')
  @ApiOperation({
    summary: 'Get my notifications',
    description:
      'Paginated, filterable list of notifications belonging to the authenticated user, newest first.',
  })
  @ApiOkResponse({
    description: 'Notifications retrieved successfully',
    type: PaginatedNotificationsResponseDto,
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({
    name: 'search',
    required: false,
    description: 'Matches title/message',
  })
  @ApiQuery({ name: 'type', required: false, enum: NotificationType })
  @ApiQuery({ name: 'status', required: false, enum: NotificationStatus })
  @ApiQuery({ name: 'unreadOnly', required: false, type: Boolean })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized',
  })
  getMyNotifications(
    @CurrentUser()
    user: any,

    @Query()
    query: GetCustomerNotificationsQueryDto,
  ) {
    return this.notificationsService.getMyNotifications(user.userId, query);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/unread-count')
  @ApiOperation({
    summary: 'Get my unread notification count',
  })
  @ApiOkResponse({
    description: 'Unread count retrieved successfully',
    type: UnreadCountResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized',
  })
  getMyUnreadCount(
    @CurrentUser()
    user: any,
  ) {
    return this.notificationsService.getMyUnreadCount(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me/read-all')
  @ApiOperation({
    summary: 'Mark all my notifications as read',
  })
  @ApiOkResponse({
    description: 'All notifications marked as read',
    type: MarkAllReadResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized',
  })
  markAllMyNotificationsAsRead(
    @CurrentUser()
    user: any,
  ) {
    return this.notificationsService.markAllMyNotificationsAsRead(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/:id')
  @ApiOperation({
    summary: 'Get one of my notifications by ID',
  })
  @ApiParam({
    name: 'id',
    description: 'Notification ID',
  })
  @ApiOkResponse({
    description: 'Notification retrieved successfully',
    type: NotificationResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Notification not found',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized',
  })
  getMyNotificationById(
    @CurrentUser()
    user: any,

    @Param('id')
    id: string,
  ) {
    return this.notificationsService.getMyNotificationById(id, user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me/:id/read')
  @ApiOperation({
    summary: 'Mark one of my notifications as read',
    description:
      "Ownership-scoped — only the notification's own recipient can mark it as read. Distinct from the legacy PATCH /notifications/:id/read, which is unscoped and left unchanged.",
  })
  @ApiParam({
    name: 'id',
    description: 'Notification ID',
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
  markMyNotificationAsRead(
    @CurrentUser()
    user: any,

    @Param('id')
    id: string,
  ) {
    return this.notificationsService.markMyNotificationAsRead(id, user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/read')
  @ApiOperation({
    summary: 'Mark notification as read (legacy)',
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
