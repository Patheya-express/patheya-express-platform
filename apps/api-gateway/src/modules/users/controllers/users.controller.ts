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

  import {
    ApiBearerAuth,
    ApiOkResponse,
    ApiOperation,
    ApiQuery,
    ApiTags,
  } from '@nestjs/swagger';
  
  import {
    UserResponseDto,
  } from '../dto/user-response.dto';
  
  @ApiTags('Users')
  @Controller('users')
  export class UsersController {
  
    constructor(
  
      private readonly usersService:
        UsersService,
  
    ) {}

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
  
      return this.usersService
        .getProfile(
          user.userId,
        );
  
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
  
      return this.usersService
        .updateProfile(
  
          user.userId,
  
          dto,
  
        );
  
    }
    @ApiBearerAuth('JWT-auth')

    @ApiOperation({
      summary: 'Get all users',
    })
    
    @ApiQuery({
      name: 'page',
      required: false,
      example: 1,
    })
    
    @ApiQuery({
      name: 'limit',
      required: false,
      example: 20,
    })
    
    @ApiOkResponse({
      description: 'Users retrieved successfully',
      type: UserResponseDto,
      isArray: true,
    })
  
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