import {
    Controller,
    Get,
    Patch,
    Param,
    Post,
    Body,
    UseGuards,
  } from '@nestjs/common';
  
  import { JwtAuthGuard }
  from '../../auth/guards/jwt-auth.guard';
  
  import { CurrentUser }
  from '../../auth/decorators/current-user.decorator';
  
  import { NotificationsService }
  from '../services/notifications.service';
  
  import { RegisterPushTokenDto }
  from '../dto/register-push-token.dto';
  
  @Controller('notifications')
  export class NotificationsController {
  
    constructor(
  
      private readonly notificationsService:
        NotificationsService,
  
    ) {}
  
    @UseGuards(JwtAuthGuard)
  
    @Get('me')
  
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
  
    markAsRead(
  
      @Param('id')
      id: string,
  
    ) {
  
      return this.notificationsService
        .markAsRead(id);
  
    }
  
    @UseGuards(JwtAuthGuard)
  
    @Post('push-token')
  
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