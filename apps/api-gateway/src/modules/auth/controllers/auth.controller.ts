import {
    Body,
    Controller,
    Get,
    Post,
    UseGuards,
  } from '@nestjs/common';
  
  import { AuthService }
  from '../services/auth.service';
  
  import { RegisterDto }
  from '../dto/register.dto';
  
  import { LoginDto }
  from '../dto/login.dto';
  
  import { JwtAuthGuard }
  from '../guards/jwt-auth.guard';
  
  import { CurrentUser }
  from '../decorators/current-user.decorator';
  
  import {
    Roles,
  } from '../decorators/roles.decorator';
  
  import {
    RolesGuard,
  } from '../guards/roles.guard';
  
  import {
    RefreshTokenDto,
  } from '../dto/refresh-token.dto';
  
  import {
    UserRole,
  } from '@prisma/client';
  
  @Controller('auth')
  export class AuthController {
  
    constructor(
  
      private readonly authService:
        AuthService,
  
    ) {}
  
    @Post('register')
  
    register(
      @Body()
      dto: RegisterDto,
    ) {
  
      return this.authService
        .register(dto);
  
    }
  
    @Post('login')
  
    login(
      @Body()
      dto: LoginDto,
    ) {
  
      return this.authService
        .login(dto);
  
    }
  
    @UseGuards(JwtAuthGuard)
  
    @Get('profile')
  
    getProfile(
  
      @CurrentUser()
      user: any,
  
    ) {
  
      return user;
  
    }
    @Post('refresh')

        refreshToken(

        @Body()
        dto: RefreshTokenDto,

        ) {

        return this.authService
            .refreshToken(dto);

    }
    @Post('logout')

    logout(

    @Body()
    dto: RefreshTokenDto,

    ) {

    return this.authService
        .logout(
        dto.refreshToken,
        );

    }
    @UseGuards(
        JwtAuthGuard,
        RolesGuard,
      )
      
      @Roles(
        UserRole.ADMIN,
      )
      
      @Get('admin-only')
      
      adminOnly() {
      
        return {
      
          message:
            'Admin access granted',
      
        };
      
      }
  
  }