import { ApiProperty } from '@nestjs/swagger';

import { AdminTicketResponseDto } from './admin-ticket-response.dto';

export class PaginatedAdminTicketsResponseDto {
  @ApiProperty({ type: [AdminTicketResponseDto] })
  items: AdminTicketResponseDto[];

  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() totalPages: number;
}
