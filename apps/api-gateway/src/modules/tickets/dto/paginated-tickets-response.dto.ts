import { ApiProperty } from '@nestjs/swagger';

import { TicketSummaryDto } from './ticket-summary.dto';

export class PaginatedTicketsResponseDto {
  @ApiProperty({ type: [TicketSummaryDto] })
  items: TicketSummaryDto[];

  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() totalPages: number;
}
