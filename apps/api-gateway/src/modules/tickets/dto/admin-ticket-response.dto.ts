import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { TicketCategory, TicketPriority, TicketStatus } from '@prisma/client';

export class AdminTicketCustomerDto {
  @ApiProperty() id: string;
  @ApiProperty() firstName: string;
  @ApiPropertyOptional() lastName?: string;
  @ApiPropertyOptional() email?: string;
  @ApiPropertyOptional() phone?: string;
}

export class AdminTicketResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() ticketNumber: string;
  @ApiProperty({ type: AdminTicketCustomerDto })
  customer: AdminTicketCustomerDto;
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
}
