import {
    Body,
    Controller,
    Get,
    Param,
    Post,
    UseGuards,
  } from '@nestjs/common';
  
  import { MenuService }
  from '../services/menu.service';
  
  import { JwtAuthGuard }
  from '../../auth/guards/jwt-auth.guard';
  
  import { CreateCategoryDto }
  from '../dto/create-category.dto';
  
  import { CreateMenuItemDto }
  from '../dto/create-menu-item.dto';
  
  @Controller('menu')
  export class MenuController {
  
    constructor(
  
      private readonly menuService:
        MenuService,
  
    ) {}
  
    @UseGuards(JwtAuthGuard)
  
    @Post('categories')
  
    createCategory(
  
      @Body()
      dto: CreateCategoryDto,
  
    ) {
  
      return this.menuService
        .createCategory(dto);
  
    }
  
    @UseGuards(JwtAuthGuard)
  
    @Post('items')
  
    createMenuItem(
  
      @Body()
      dto: CreateMenuItemDto,
  
    ) {
  
      return this.menuService
        .createMenuItem(dto);
  
    }
  
    @Get(':restaurantId')
  
    getRestaurantMenu(
  
      @Param('restaurantId')
      restaurantId: string,
  
    ) {
  
      return this.menuService
        .getRestaurantMenu(
          restaurantId,
        );
  
    }
  
  }