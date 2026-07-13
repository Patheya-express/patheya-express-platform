import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';

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

import { ForgotPasswordDto } from '../dto/forgot-password.dto';

import { ResetPasswordDto } from '../dto/reset-password.dto';

import { PasswordResetMessageDto } from '../dto/password-reset-message.dto';

import { RegisterResponseDto } from '../dto/register-response.dto';

import { RefreshResponseDto } from '../dto/refresh-response.dto';

import { LogoutResponseDto } from '../dto/logout-response.dto';

import { JwtAuthGuard } from '../guards/jwt-auth.guard';

import { RolesGuard } from '../guards/roles.guard';

import { CurrentUser } from '../decorators/current-user.decorator';

import { Roles } from '../decorators/roles.decorator';
import { AuthUserDto } from '../dto/auth-user.dto';
import { Throttle } from '@nestjs/throttler';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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

  @Post('register/delivery-partner')
  @Throttle({
    default: {
      limit: 3,
      ttl: 60000,
    },
  })
  @ApiOperation({
    summary: 'Register a new delivery partner',
  })
  @ApiCreatedResponse({
    description: 'Delivery partner account registered successfully',
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
  registerDeliveryPartner(
    @Body()
    dto: RegisterDto,
  ) {
    return this.authService.registerDeliveryPartner(dto);
  }

  @Post('register/restaurant-owner')
  @Throttle({
    default: {
      limit: 3,
      ttl: 60000,
    },
  })
  @ApiOperation({
    summary: 'Register a new restaurant owner',
  })
  @ApiCreatedResponse({
    description: 'Restaurant owner account registered successfully',
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
  registerRestaurantOwner(
    @Body()
    dto: RegisterDto,
  ) {
    return this.authService.registerRestaurantOwner(dto);
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
    type: AuthUserDto,
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
    return this.authService.getProfile(user.userId);
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
    return this.authService.logout(dto.refreshToken);
  }

  @Post('forgot-password')
  @Throttle({
    default: {
      limit: 3,
      ttl: 60000,
    },
  })
  @ApiOperation({
    summary: 'Request a password reset link',
    description:
      'Always returns the same message whether or not the email matches an account, to avoid revealing account existence.',
  })
  @ApiOkResponse({
    description: 'Request accepted',
    type: PasswordResetMessageDto,
  })
  forgotPassword(
    @Body()
    dto: ForgotPasswordDto,
  ) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  @Throttle({
    default: {
      limit: 5,
      ttl: 60000,
    },
  })
  @ApiOperation({
    summary: 'Reset password using a token from the emailed reset link',
  })
  @ApiOkResponse({
    description: 'Password reset successfully',
    type: PasswordResetMessageDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid, already-used, or expired reset link',
  })
  resetPassword(
    @Body()
    dto: ResetPasswordDto,
  ) {
    return this.authService.resetPassword(dto);
  }

  @Get('admin-only')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
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
      message: 'Admin access granted',
    };
  }
}
