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
  
  @Controller('restaurants')
  export class RestaurantsController {
  
    constructor(
  
      private readonly restaurantsService:
        RestaurantsService,
  
    ) {}
  
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