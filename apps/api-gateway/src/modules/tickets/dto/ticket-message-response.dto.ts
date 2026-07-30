import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { TicketMessageSenderType } from '@prisma/client';

import { TicketAttachmentResponseDto } from './ticket-attachment-response.dto';

export class TicketMessageResponseDto {
  @ApiProperty() id: string;
  @ApiPropertyOptional() senderId?: string;
  @ApiProperty({ enum: TicketMessageSenderType })
  senderType: TicketMessageSenderType;
  @ApiProperty() message: string;
  @ApiProperty({ type: [TicketAttachmentResponseDto] })
  attachments: TicketAttachmentResponseDto[];
  @ApiProperty() createdAt: Date;
}
