/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import {
  Body,
  Controller,
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
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import type { UploadFile } from '../../../shared/types/upload-file.type';

import { UserRole, RestaurantStatus } from '@prisma/client';

import { RestaurantsService } from '../services/restaurants.service';

import { CreateRestaurantDto } from '../dto/create-restaurant.dto';
import { GetRestaurantsQueryDto } from '../dto/get-restaurants-query.dto';
import { GetAdminRestaurantsQueryDto } from '../dto/get-admin-restaurants-query.dto';
import { RestaurantResponseDto } from '../dto/restaurant-response.dto';
import { PaginatedRestaurantsResponseDto } from '../dto/paginated-restaurants-response.dto';
import { PaginatedRestaurantSummariesResponseDto } from '../dto/paginated-restaurant-summaries-response.dto';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@ApiTags('Restaurants')
@Controller('restaurants')
export class RestaurantsController {
  constructor(private readonly restaurantsService: RestaurantsService) {}

  @ApiOperation({
    summary: 'Get restaurants',
    description:
      'Returns a paginated list of restaurants available to customers.',
  })
  @ApiOkResponse({
    description: 'Restaurants retrieved successfully.',
    type: PaginatedRestaurantSummariesResponseDto,
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
    name: 'city',
    required: false,
  })
  @ApiQuery({
    name: 'cuisine',
    required: false,
  })
  @ApiQuery({
    name: 'featured',
    required: false,
    type: Boolean,
  })
  @ApiQuery({
    name: 'openNow',
    required: false,
    type: Boolean,
  })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    enum: ['name', 'rating', 'createdAt'],
  })
  @ApiQuery({
    name: 'sortOrder',
    required: false,
    enum: ['asc', 'desc'],
  })
  @Get()
  findAll(
    @Query()
    query: GetRestaurantsQueryDto,
  ) {
    return this.restaurantsService.findAll(query);
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Create restaurant',
  })
  @ApiCreatedResponse({
    description: 'Restaurant created successfully',
    type: RestaurantResponseDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Restaurant slug already exists',
  })
  @UseGuards(JwtAuthGuard)
  @Post()
  createRestaurant(
    @CurrentUser()
    user: any,

    @Body()
    dto: CreateRestaurantDto,
  ) {
    return this.restaurantsService.createRestaurant(user.userId, dto);
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Get restaurants owned by current user',
  })
  @ApiOkResponse({
    description: 'Restaurants retrieved successfully',
    type: RestaurantResponseDto,
    isArray: true,
  })
  @UseGuards(JwtAuthGuard)
  @Get('me')
  getMyRestaurants(
    @CurrentUser()
    user: any,
  ) {
    return this.restaurantsService.getMyRestaurants(user.userId);
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Get restaurants (admin)',
    description:
      'Returns a paginated, filterable, platform-wide list of restaurants of any status, including owner information. Distinct from the public listing, which only ever returns approved, active restaurants and never includes owner details.',
  })
  @ApiOkResponse({
    description: 'Restaurants retrieved successfully',
    type: PaginatedRestaurantsResponseDto,
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
    description:
      'Matches restaurant name, owner first name, owner last name, or owner email',
  })
  @ApiQuery({
    name: 'city',
    required: false,
  })
  @ApiQuery({
    name: 'cuisine',
    required: false,
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: RestaurantStatus,
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Get('admin')
  getAllForAdmin(
    @Query()
    query: GetAdminRestaurantsQueryDto,
  ) {
    return this.restaurantsService.getAllForAdmin(query);
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Approve restaurant',
    description: 'Approves a pending restaurant application.',
  })
  @ApiParam({
    name: 'id',
  })
  @ApiOkResponse({
    description: 'Restaurant approved successfully',
    type: RestaurantResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Only pending restaurants can be approved',
  })
  @ApiResponse({
    status: 404,
    description: 'Restaurant not found',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Patch(':id/approve')
  approveRestaurant(
    @Param('id')
    id: string,
  ) {
    return this.restaurantsService.approveRestaurant(id);
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Reject restaurant',
    description: 'Rejects a pending restaurant application.',
  })
  @ApiParam({
    name: 'id',
  })
  @ApiOkResponse({
    description: 'Restaurant rejected successfully',
    type: RestaurantResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Only pending restaurants can be rejected',
  })
  @ApiResponse({
    status: 404,
    description: 'Restaurant not found',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Patch(':id/reject')
  rejectRestaurant(
    @Param('id')
    id: string,
  ) {
    return this.restaurantsService.rejectRestaurant(id);
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Suspend restaurant',
    description: 'Suspends an approved restaurant.',
  })
  @ApiParam({
    name: 'id',
  })
  @ApiOkResponse({
    description: 'Restaurant suspended successfully',
    type: RestaurantResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Only approved restaurants can be suspended',
  })
  @ApiResponse({
    status: 404,
    description: 'Restaurant not found',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Patch(':id/suspend')
  suspendRestaurant(
    @Param('id')
    id: string,
  ) {
    return this.restaurantsService.suspendRestaurant(id);
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Restore restaurant',
    description: 'Restores a suspended restaurant back to approved.',
  })
  @ApiParam({
    name: 'id',
  })
  @ApiOkResponse({
    description: 'Restaurant restored successfully',
    type: RestaurantResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Only suspended restaurants can be restored',
  })
  @ApiResponse({
    status: 404,
    description: 'Restaurant not found',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Patch(':id/restore')
  restoreRestaurant(
    @Param('id')
    id: string,
  ) {
    return this.restaurantsService.restoreRestaurant(id);
  }

  @ApiOperation({
    summary: 'Get restaurant by ID',
    description:
      'Public — no authentication required, so anonymous customers can browse restaurant detail pages.',
  })
  @ApiParam({
    name: 'id',
    example: 'c7c1f1e2-6f2d-4f77-a111-123456789abc',
  })
  @ApiOkResponse({
    description: 'Restaurant retrieved successfully',
    type: RestaurantResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Restaurant not found',
  })
  @Get(':id')
  getRestaurantById(
    @Param('id')
    id: string,
  ) {
    return this.restaurantsService.getRestaurantById(id);
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Upload restaurant logo',
  })
  @ApiParam({
    name: 'id',
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
    description: 'Logo uploaded successfully',
    type: RestaurantResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Restaurant not found',
  })
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  @Post(':id/logo')
  uploadLogo(
    @Param('id')
    id: string,

    @UploadedFile()
    file: UploadFile,
  ) {
    return this.restaurantsService.uploadLogo(id, file);
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Upload restaurant banner',
  })
  @ApiParam({
    name: 'id',
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
    description: 'Banner uploaded successfully',
    type: RestaurantResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Restaurant not found',
  })
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  @Post(':id/banner')
  uploadBanner(
    @Param('id')
    id: string,

    @UploadedFile()
    file: UploadFile,
  ) {
    return this.restaurantsService.uploadBanner(id, file);
  }
}
