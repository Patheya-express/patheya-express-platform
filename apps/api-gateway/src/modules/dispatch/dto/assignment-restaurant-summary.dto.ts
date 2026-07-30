import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AssignmentRestaurantSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional()
  phone?: string;
}
