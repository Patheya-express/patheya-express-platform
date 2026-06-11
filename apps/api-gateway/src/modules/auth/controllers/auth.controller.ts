import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';

import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { UserRole } from '@prisma/client';

import { AuthService } from '../services/auth.service';

import { RegisterDto } from '../dto/register.dto';

import { LoginDto } from '../dto/login.dto';

import { RefreshTokenDto } from '../dto/refresh-token.dto';

import { RegisterResponseDto } from '../dto/register-response.dto';

import { RefreshResponseDto } from '../dto/refresh-response.dto';

import { LogoutResponseDto } from '../dto/logout-response.dto';

import { JwtAuthGuard } from '../guards/jwt-auth.guard';

import { RolesGuard } from '../guards/roles.guard';

import { CurrentUser } from '../decorators/current-user.decorator';

import { Roles } from '../decorators/roles.decorator';
import { AuthUserDto }
from '../dto/auth-user.dto';
import {
  Throttle,
} from '@nestjs/throttler';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {

  constructor(
    private readonly authService: AuthService,
  ) {}

  @Post('register')
  @Throttle({
    default: {
      limit: 3,
      ttl: 60000,
    },
  })
  @ApiOperation({
    summary: 'Register a new customer',
  })
  @ApiCreatedResponse({
    description: 'Customer registered successfully',
    type: RegisterResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed',
  })
  @ApiResponse({
    status: 409,
    description: 'User already exists',
  })
  register(
    @Body()
    dto: RegisterDto,
  ) {
    return this.authService.register(dto);
  }

  @Post('login')
  @Throttle({
    default: {
      limit: 5,
      ttl: 60000,
    },
  })
  @ApiOperation({
    summary: 'Login customer',
  })
  @ApiOkResponse({
    description: 'Login successful',
    type: RegisterResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid credentials',
  })
  login(
    @Body()
    dto: LoginDto,
  ) {
    return this.authService.login(dto);
  }

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Get authenticated user profile',
  })
  @ApiOkResponse({
    description: 'Authenticated user profile',
    type:AuthUserDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })

@Get('profile')
getProfile(
  @CurrentUser()
  user: any,
) {
  return this.authService.getProfile(
    user.userId,
  );
}

  @Post('refresh')
  @Throttle({
    default: {
      limit: 20,
      ttl: 60000,
    },
  })
  @ApiOperation({
    summary: 'Generate new access token using refresh token',
  })
  @ApiOkResponse({
    description: 'Access token refreshed successfully',
    type: RefreshResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid refresh token',
  })
  refreshToken(
    @Body()
    dto: RefreshTokenDto,
  ) {
    return this.authService.refreshToken(dto);
  }

  @Post('logout')
  @Throttle({
    default: {
      limit: 20,
      ttl: 60000,
    },
  })
  @ApiOperation({
    summary: 'Logout user and revoke refresh token',
  })
  @ApiOkResponse({
    description: 'Logout successful',
    type: LogoutResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid refresh token',
  })
  logout(
    @Body()
    dto: RefreshTokenDto,
  ) {
    return this.authService.logout(
      dto.refreshToken,
    );
  }

  @Get('admin-only')
  @UseGuards(
    JwtAuthGuard,
    RolesGuard,
  )
  @Roles(
    UserRole.ADMIN,
  )
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Admin protected endpoint',
  })
  @ApiOkResponse({
    description: 'Admin access granted',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden',
  })
  adminOnly() {
    return {
      message:
        'Admin access granted',
    };
  }

}