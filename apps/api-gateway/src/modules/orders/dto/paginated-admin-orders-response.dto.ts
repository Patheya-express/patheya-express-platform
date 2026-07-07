import { ApiProperty } from '@nestjs/swagger';

import { AdminOrderResponseDto } from './admin-order-response.dto';

export class PaginatedAdminOrdersResponseDto {
  @ApiProperty({
    type: [AdminOrderResponseDto],
  })
  items: AdminOrderResponseDto[];

  @ApiProperty({
    example: 42,
  })
  total: number;

  @ApiProperty({
    example: 1,
  })
  page: number;

  @ApiProperty({
    example: 20,
  })
  limit: number;

  @ApiProperty({
    example: 3,
  })
  totalPages: number;
}
