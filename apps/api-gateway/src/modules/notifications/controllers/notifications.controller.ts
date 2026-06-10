import {
  Controller,
  Get,
  Patch,
  Param,
  Post,
  Body,
  UseGuards,
} from '@nestjs/common';

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

import { JwtAuthGuard }
from '../../auth/guards/jwt-auth.guard';

import { CurrentUser }
from '../../auth/decorators/current-user.decorator';

import { NotificationsService }
from '../services/notifications.service';

import { RegisterPushTokenDto }
from '../dto/register-push-token.dto';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {

  constructor(

    private readonly notificationsService:
      NotificationsService,

  ) {}

  @UseGuards(JwtAuthGuard)

  @Get('me')

  @ApiOperation({
    summary: 'Get my notifications',
    description:
      'Returns notifications belonging to the authenticated user.',
  })

  @ApiOkResponse({
    description:
      'Notifications fetched successfully',
  })

  @ApiUnauthorizedResponse({
    description:
      'Unauthorized',
  })

  getMyNotifications(

    @CurrentUser()
    user: any,

  ) {

    return this.notificationsService
      .getMyNotifications(
        user.userId,
      );

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
    description:
      'Notification marked as read',
  })

  @ApiNotFoundResponse({
    description:
      'Notification not found',
  })

  @ApiUnauthorizedResponse({
    description:
      'Unauthorized',
  })

  markAsRead(

    @Param('id')
    id: string,

  ) {

    return this.notificationsService
      .markAsRead(id);

  }

  @UseGuards(JwtAuthGuard)

  @Post('push-token')

  @ApiOperation({
    summary: 'Register push notification token',
    description:
      'Register a device push token for receiving notifications.',
  })

  @ApiBody({
    type: RegisterPushTokenDto,
  })

  @ApiOkResponse({
    description:
      'Push token registered successfully',
  })

  @ApiUnauthorizedResponse({
    description:
      'Unauthorized',
  })

  registerPushToken(

    @CurrentUser()
    user: any,

    @Body()
    dto: RegisterPushTokenDto,

  ) {

    return this.notificationsService
      .registerPushToken(

        user.userId,

        dto.token,

        dto.platform,

      );

  }

}