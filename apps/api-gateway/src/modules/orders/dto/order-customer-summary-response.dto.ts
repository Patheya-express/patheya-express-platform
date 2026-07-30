import { ApiProperty } from '@nestjs/swagger';

export class OrderCustomerSummaryResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  firstName: string;

  @ApiProperty({
    required: false,
  })
  lastName?: string;
}
