import {
    ApiProperty,
  } from '@nestjs/swagger';
  
  import {
    MenuItemResponseDto,
  } from './menu-item-response.dto';
  
  export class MenuCategoryResponseDto {
  
    @ApiProperty()
    id: string;
  
    @ApiProperty()
    restaurantId: string;
  
    @ApiProperty({
      example: 'Biryani',
    })
    name: string;
  
    @ApiProperty({
      required: false,
    })
    description?: string;
  
    @ApiProperty({
      example: 0,
    })
    sortOrder: number;
  
    @ApiProperty()
    isActive: boolean;
  
    @ApiProperty({
      type:
        [MenuItemResponseDto],
    })
    menuItems:
      MenuItemResponseDto[];
  
  }