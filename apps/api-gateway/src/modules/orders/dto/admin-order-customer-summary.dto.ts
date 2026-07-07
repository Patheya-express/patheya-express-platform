import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AdminOrderCustomerSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  firstName: string;

  @ApiPropertyOptional()
  lastName?: string;

  @ApiPropertyOptional()
  email?: string;

  @ApiPropertyOptional()
  phone?: string;
}
