import {
    Body,
    Controller,
    Get,
    Param,
    Post,
    UseGuards,
  } from '@nestjs/common';
  
  import { RestaurantsService }
  from '../services/restaurants.service';
  
  import { CreateRestaurantDto }
  from '../dto/create-restaurant.dto';
  
  import { JwtAuthGuard }
  from '../../auth/guards/jwt-auth.guard';
  
  import { CurrentUser }
  from '../../auth/decorators/current-user.decorator';

  import {
    ApiBearerAuth,
    ApiOkResponse,
    ApiOperation,
    ApiParam,
    ApiTags,
    ApiCreatedResponse,
    ApiResponse
  } from '@nestjs/swagger';
  
  import {
    RestaurantResponseDto,
  } from '../dto/restaurant-response.dto';
  
  @ApiTags('Restaurants')
  @Controller('restaurants')
  export class RestaurantsController {
  
    constructor(
  
      private readonly restaurantsService:
        RestaurantsService,
  
    ) {}
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
  
      return this.restaurantsService
        .createRestaurant(
  
          user.userId,
  
          dto,
  
        );
  
    }
    @ApiBearerAuth('JWT-auth')

    @ApiOperation({
      summary:
        'Get restaurants owned by current user',
    })

    @ApiOkResponse({
      description:
        'Restaurants retrieved successfully',
      type: RestaurantResponseDto,
      isArray: true,
    })
  
    @UseGuards(JwtAuthGuard)
  
    @Get('me')
  
    getMyRestaurants(
  
      @CurrentUser()
      user: any,
  
    ) {
  
      return this.restaurantsService
        .getMyRestaurants(
          user.userId,
        );
  
    }
    @ApiBearerAuth('JWT-auth')

    @ApiOperation({
      summary: 'Get restaurant by ID',
    })

    @ApiParam({
      name: 'id',
      example:
        'c7c1f1e2-6f2d-4f77-a111-123456789abc',
    })

    @ApiOkResponse({
      description:
        'Restaurant retrieved successfully',
      type: RestaurantResponseDto,
    })
    @ApiResponse({
      status: 404,
      description: 'Restaurant not found',
    })
  
    @UseGuards(JwtAuthGuard)
  
    @Get(':id')
  
    getRestaurantById(
  
      @Param('id')
      id: string,
  
    ) {
  
      return this.restaurantsService
        .getRestaurantById(id);
  
    }
  
  }