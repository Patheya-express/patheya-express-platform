import { ApiProperty } from '@nestjs/swagger';

export class TicketAttachmentResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() fileUrl: string;
  @ApiProperty() fileName: string;
  @ApiProperty() mimeType: string;
  @ApiProperty() sizeBytes: number;
  @ApiProperty() uploadedById: string;
  @ApiProperty() createdAt: Date;
}
