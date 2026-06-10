import {
    Controller,
    Get,
    Param,
    Post,
    UseGuards,
  } from '@nestjs/common';
  
  import { JwtAuthGuard }
  from '../../auth/guards/jwt-auth.guard';
  
  import { CurrentUser }
  from '../../auth/decorators/current-user.decorator';
  
  import { PresenceService }
  from '../services/presence.service';
  
  @Controller('presence')
  export class PresenceController {
  
    constructor(
  
      private readonly presenceService:
        PresenceService,
  
    ) {}
  
    @UseGuards(JwtAuthGuard)
    @Post('online')
  
    async markOnline(
  
      @CurrentUser()
      user: any,
  
    ) {
  
      return this.presenceService
        .markOnline(
          user.userId,
        );
  
    }
  
    @UseGuards(JwtAuthGuard)
    @Post('offline')
  
    async markOffline(
  
      @CurrentUser()
      user: any,
  
    ) {
  
      return this.presenceService
        .markOffline(
          user.userId,
        );
  
    }
  
    @UseGuards(JwtAuthGuard)
    @Get(':partnerId')
  
    async getStatus(
  
      @Param('partnerId')
      partnerId: string,
  
    ) {
  
      return this.presenceService
        .getStatus(
          partnerId,
        );
  
    }
  
  }