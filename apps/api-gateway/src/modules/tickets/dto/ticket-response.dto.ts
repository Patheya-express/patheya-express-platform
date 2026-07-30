import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { TicketCategory, TicketPriority, TicketStatus } from '@prisma/client';

import { TicketMessageResponseDto } from './ticket-message-response.dto';

export class TicketResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() ticketNumber: string;
  @ApiProperty() customerId: string;
  @ApiPropertyOptional() assignedAgentId?: string;
  @ApiPropertyOptional() orderId?: string;
  @ApiPropertyOptional() paymentId?: string;
  @ApiProperty({ enum: TicketCategory }) category: TicketCategory;
  @ApiProperty({ enum: TicketPriority }) priority: TicketPriority;
  @ApiProperty({ enum: TicketStatus }) status: TicketStatus;
  @ApiProperty() subject: string;
  @ApiProperty() description: string;
  @ApiPropertyOptional() firstResponseAt?: Date;
  @ApiPropertyOptional() resolvedAt?: Date;
  @ApiPropertyOptional() escalatedAt?: Date;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
  @ApiProperty({ type: [TicketMessageResponseDto] })
  messages: TicketMessageResponseDto[];
}
