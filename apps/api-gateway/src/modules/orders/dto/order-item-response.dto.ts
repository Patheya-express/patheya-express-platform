import {
    ApiProperty,
  } from '@nestjs/swagger';
  
  export class OrderItemResponseDto {
  
    @ApiProperty()
    id: string;
  
    @ApiProperty()
    menuItemId: string;
  
    @ApiProperty({
      example: 2,
    })
    quantity: number;
  
    @ApiProperty({
      example: 249,
    })
    unitPrice: number;
  
    @ApiProperty({
      example: 498,
    })
    totalPrice: number;
  
    @ApiProperty({
      required: false,
    })
    specialInstructions?: string;
  
  }