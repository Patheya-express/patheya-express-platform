import {
    Body,
    Controller,
    Get,
    Patch,
    Query,
    UseGuards,
  } from '@nestjs/common';
  
  import { UsersService }
  from '../services/users.service';
  
  import { JwtAuthGuard }
  from '../../auth/guards/jwt-auth.guard';
  
  import { CurrentUser }
  from '../../auth/decorators/current-user.decorator';
  
  import { UpdateProfileDto }
  from '../dto/update-profile.dto';
  
  import {
    Roles,
  } from '../../auth/decorators/roles.decorator';
  
  import {
    RolesGuard,
  } from '../../auth/guards/roles.guard';
  
  import {
    UserRole,
  } from '@prisma/client';
  
  @Controller('users')
  export class UsersController {
  
    constructor(
  
      private readonly usersService:
        UsersService,
  
    ) {}
  
    @UseGuards(JwtAuthGuard)
  
    @Get('me')
  
    getProfile(
  
      @CurrentUser()
      user: any,
  
    ) {
  
      return this.usersService
        .getProfile(
          user.userId,
        );
  
    }
  
    @UseGuards(JwtAuthGuard)
  
    @Patch('me')
  
    updateProfile(
  
      @CurrentUser()
      user: any,
  
      @Body()
      dto: UpdateProfileDto,
  
    ) {
  
      return this.usersService
        .updateProfile(
  
          user.userId,
  
          dto,
  
        );
  
    }
  
    @UseGuards(
      JwtAuthGuard,
      RolesGuard,
    )
  
    @Roles(
      UserRole.ADMIN,
      UserRole.SUPER_ADMIN,
    )
  
    @Get()
  
    getAllUsers(
  
      @Query('page')
      page = 1,
  
      @Query('limit')
      limit = 20,
  
    ) {
  
      return this.usersService
        .getAllUsers(
          Number(page),
          Number(limit),
        );
  
    }
  
  }