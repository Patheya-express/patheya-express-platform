import {
    Injectable,
  } from '@nestjs/common';
  
  import { MenuRepository }
  from '../repositories/menu.repository';
  
  import { CreateCategoryDto }
  from '../dto/create-category.dto';
  
  import { CreateMenuItemDto }
  from '../dto/create-menu-item.dto';
  
  @Injectable()
  export class MenuService {
  
    constructor(
  
      private readonly menuRepository:
        MenuRepository,
  
    ) {}
  
    async createCategory(
      dto: CreateCategoryDto,
    ) {
  
      return this.menuRepository
        .createCategory(dto);
  
    }
  
    async createMenuItem(
      dto: CreateMenuItemDto,
    ) {
  
      return this.menuRepository
        .createMenuItem(dto);
  
    }
  
    async getRestaurantMenu(
      restaurantId: string,
    ) {
  
      return this.menuRepository
        .getRestaurantMenu(
          restaurantId,
        );
  
    }
  
  }