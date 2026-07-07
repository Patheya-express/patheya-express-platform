import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AdminOrderDeliveryPartnerSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  firstName: string;

  @ApiPropertyOptional()
  lastName?: string;

  @ApiPropertyOptional()
  phone?: string;
}
