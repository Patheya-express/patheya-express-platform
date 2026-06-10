import {
    ApiProperty,
  } from '@nestjs/swagger';
  
  export class MenuItemVariantResponseDto {
  
    @ApiProperty()
    id: string;
  
    @ApiProperty()
    menuItemId: string;
  
    @ApiProperty({
      example: 'Large',
    })
    name: string;
  
    @ApiProperty({
      example: 50,
    })
    price: number;
  
    @ApiProperty({
      example: false,
    })
    isDefault: boolean;
  
  }