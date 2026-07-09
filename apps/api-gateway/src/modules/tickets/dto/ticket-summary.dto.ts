import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { TicketCategory, TicketPriority, TicketStatus } from '@prisma/client';

export class TicketSummaryDto {
  @ApiProperty() id: string;
  @ApiProperty() ticketNumber: string;
  @ApiPropertyOptional() assignedAgentId?: string;
  @ApiProperty({ enum: TicketCategory }) category: TicketCategory;
  @ApiProperty({ enum: TicketPriority }) priority: TicketPriority;
  @ApiProperty({ enum: TicketStatus }) status: TicketStatus;
  @ApiProperty() subject: string;
  @ApiPropertyOptional() orderId?: string;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}
