import {
    ApiProperty,
  } from '@nestjs/swagger';
  
  import {
    MenuAddonOptionResponseDto,
  } from './menu-addon-option-response.dto';
  
  export class MenuAddonResponseDto {
  
    @ApiProperty()
    id: string;
  
    @ApiProperty()
    menuItemId: string;
  
    @ApiProperty({
      example: 'Extra Toppings',
    })
    name: string;
  
    @ApiProperty({
      example: 0,
    })
    minSelection: number;
  
    @ApiProperty({
      example: 3,
    })
    maxSelection: number;
  
    @ApiProperty({
      type:
        [MenuAddonOptionResponseDto],
    })
    options:
      MenuAddonOptionResponseDto[];
  
  }