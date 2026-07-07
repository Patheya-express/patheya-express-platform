import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AdminPaymentCustomerSummaryDto {
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
