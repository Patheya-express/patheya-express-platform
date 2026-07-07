import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AssignmentOrderItemSummaryDto {
  @ApiProperty()
  id: string;

  @ApiPropertyOptional()
  menuItemName?: string;

  @ApiProperty()
  quantity: number;

  @ApiProperty()
  unitPrice: number;

  @ApiProperty()
  totalPrice: number;
}
