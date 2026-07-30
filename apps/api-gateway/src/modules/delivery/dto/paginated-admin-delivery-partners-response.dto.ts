import { ApiProperty } from '@nestjs/swagger';

import { AdminDeliveryPartnerResponseDto } from './admin-delivery-partner-response.dto';

export class PaginatedAdminDeliveryPartnersResponseDto {
  @ApiProperty({
    type: [AdminDeliveryPartnerResponseDto],
  })
  items: AdminDeliveryPartnerResponseDto[];

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
