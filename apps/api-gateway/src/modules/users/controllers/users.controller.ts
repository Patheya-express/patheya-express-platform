import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';

import { FileInterceptor } from '@nestjs/platform-express';

import {
  createUploadInterceptorOptions,
  IMAGE_MAX_SIZE_BYTES,
  IMAGE_MIME_TYPES,
} from '../../storage/utils/upload-validation.util';

import { UsersService } from '../services/users.service';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';

import { UpdateProfileDto } from '../dto/update-profile.dto';

import { Roles } from '../../auth/decorators/roles.decorator';

import { RolesGuard } from '../../auth/guards/roles.guard';

import { UserRole } from '@prisma/client';

import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { UserStatus } from '@prisma/client';

import { UserResponseDto } from '../dto/user-response.dto';
import { GetUsersQueryDto } from '../dto/get-users-query.dto';
import { PaginatedUsersResponseDto } from '../dto/paginated-users-response.dto';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { UpdatePreferencesDto } from '../dto/update-preferences.dto';
import { NotificationPreferencesResponseDto } from '../dto/notification-preferences-response.dto';
import { SuccessResponseDto } from '../dto/success-response.dto';

import type { UploadFile } from '../../../shared/types/upload-file.type';

@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Get current user profile',
  })
  @ApiOkResponse({
    description: 'User profile retrieved successfully',
    type: UserResponseDto,
  })
  @UseGuards(JwtAuthGuard)
  @Get('me')
  getProfile(
    @CurrentUser()
    user: any,
  ) {
    return this.usersService.getProfile(user.userId);
  }
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Update current user profile',
  })
  @ApiOkResponse({
    description: 'Profile updated successfully',
    type: UserResponseDto,
  })
  @UseGuards(JwtAuthGuard)
  @Patch('me')
  updateProfile(
    @CurrentUser()
    user: any,

    @Body()
    dto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(
      user.userId,

      dto,
    );
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Change current user password',
    description:
      'Requires the current password. The new password must meet the strong-password policy. Existing JWT access tokens remain valid until they expire; refresh tokens are not revoked.',
  })
  @ApiOkResponse({
    description: 'Password changed successfully',
    type: SuccessResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Current password is incorrect',
  })
  @ApiBadRequestResponse({
    description: 'Password login is not enabled for this account',
  })
  @UseGuards(JwtAuthGuard)
  @Patch('me/password')
  changePassword(
    @CurrentUser()
    user: any,

    @Body()
    dto: ChangePasswordDto,
  ) {
    return this.usersService.changePassword(user.userId, dto);
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Upload current user avatar',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiOkResponse({
    description: 'Avatar uploaded successfully',
    type: UserResponseDto,
  })
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor(
      'file',
      createUploadInterceptorOptions(IMAGE_MIME_TYPES, IMAGE_MAX_SIZE_BYTES),
    ),
  )
  @Post('me/avatar')
  uploadAvatar(
    @CurrentUser()
    user: any,

    @UploadedFile()
    file: UploadFile,
  ) {
    return this.usersService.uploadAvatar(user.userId, file);
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Get current user notification preferences',
  })
  @ApiOkResponse({
    description: 'Notification preferences retrieved successfully',
    type: NotificationPreferencesResponseDto,
  })
  @UseGuards(JwtAuthGuard)
  @Get('me/preferences')
  getPreferences(
    @CurrentUser()
    user: any,
  ) {
    return this.usersService.getPreferences(user.userId);
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Update current user notification preferences',
  })
  @ApiOkResponse({
    description: 'Notification preferences updated successfully',
    type: NotificationPreferencesResponseDto,
  })
  @UseGuards(JwtAuthGuard)
  @Patch('me/preferences')
  updatePreferences(
    @CurrentUser()
    user: any,

    @Body()
    dto: UpdatePreferencesDto,
  ) {
    return this.usersService.updatePreferences(user.userId, dto);
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Delete current user account',
    description:
      'Soft deletes the account (never a hard delete), revokes all active refresh tokens, and records an audit log entry.',
  })
  @ApiOkResponse({
    description: 'Account deleted successfully',
    type: SuccessResponseDto,
  })
  @UseGuards(JwtAuthGuard)
  @Delete('me')
  deleteAccount(
    @CurrentUser()
    user: any,
  ) {
    return this.usersService.deleteAccount(user.userId);
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Get all users',
    description: 'Returns a paginated, filterable list of platform users.',
  })
  @ApiOkResponse({
    description: 'Users retrieved successfully',
    type: PaginatedUsersResponseDto,
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
  })
  @ApiQuery({
    name: 'role',
    required: false,
    enum: UserRole,
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: UserStatus,
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Get()
  getAllUsers(
    @Query()
    query: GetUsersQueryDto,
  ) {
    return this.usersService.getAllUsers(query);
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Activate user',
    description: 'Activates an inactive user account.',
  })
  @ApiParam({
    name: 'id',
    description: 'User ID',
  })
  @ApiOkResponse({
    description: 'User activated successfully',
    type: UserResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Only inactive users can be activated',
  })
  @ApiNotFoundResponse({
    description: 'User not found',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Patch(':id/activate')
  activateUser(
    @Param('id')
    id: string,

    @CurrentUser()
    user: any,
  ) {
    return this.usersService.activateUser(id, user.userId);
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Suspend user',
    description: 'Suspends an active user account.',
  })
  @ApiParam({
    name: 'id',
    description: 'User ID',
  })
  @ApiOkResponse({
    description: 'User suspended successfully',
    type: UserResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Only active users can be suspended',
  })
  @ApiForbiddenResponse({
    description: 'Cannot suspend your own account or a super admin account',
  })
  @ApiNotFoundResponse({
    description: 'User not found',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Patch(':id/suspend')
  suspendUser(
    @Param('id')
    id: string,

    @CurrentUser()
    user: any,
  ) {
    return this.usersService.suspendUser(id, user.userId);
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Restore user',
    description: 'Restores a suspended or blocked user account back to active.',
  })
  @ApiParam({
    name: 'id',
    description: 'User ID',
  })
  @ApiOkResponse({
    description: 'User restored successfully',
    type: UserResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Only suspended or blocked users can be restored',
  })
  @ApiNotFoundResponse({
    description: 'User not found',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Patch(':id/restore')
  restoreUser(
    @Param('id')
    id: string,

    @CurrentUser()
    user: any,
  ) {
    return this.usersService.restoreUser(id, user.userId);
  }
}
