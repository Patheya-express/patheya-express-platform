import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';

import { UsersService } from '../services/users.service';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';

import { UpdateProfileDto } from '../dto/update-profile.dto';

import { Roles } from '../../auth/decorators/roles.decorator';

import { RolesGuard } from '../../auth/guards/roles.guard';

import { UserRole } from '@prisma/client';

import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';

import { UserStatus } from '@prisma/client';

import { UserResponseDto } from '../dto/user-response.dto';
import { GetUsersQueryDto } from '../dto/get-users-query.dto';
import { PaginatedUsersResponseDto } from '../dto/paginated-users-response.dto';

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
  ) {
    return this.usersService.activateUser(id);
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
  ) {
    return this.usersService.restoreUser(id);
  }
}
