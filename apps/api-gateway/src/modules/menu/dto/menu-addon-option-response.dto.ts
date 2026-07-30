import { ApiProperty } from '@nestjs/swagger';

export class MenuAddonOptionResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  addonId: string;

  @ApiProperty({
    example: 'Extra Cheese',
  })
  name: string;

  @ApiProperty({
    example: 30,
  })
  price: number;

  @ApiProperty({
    example: true,
  })
  isAvailable: boolean;
}
