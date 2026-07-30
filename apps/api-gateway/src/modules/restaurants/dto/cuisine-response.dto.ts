import { ApiProperty } from '@nestjs/swagger';

export class CuisineResponseDto {
  @ApiProperty({
    example: 'c7c1f1e2-6f2d-4f77-a111-123456789abc',
  })
  id: string;

  @ApiProperty({
    example: 'North Indian',
  })
  name: string;
}
