import { ApiProperty } from '@nestjs/swagger';

import { AdminPaymentResponseDto } from './admin-payment-response.dto';

export class PaginatedAdminPaymentsResponseDto {
  @ApiProperty({
    type: AdminPaymentResponseDto,
    isArray: true,
  })
  items: AdminPaymentResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;

  @ApiProperty()
  totalPages: number;
}
