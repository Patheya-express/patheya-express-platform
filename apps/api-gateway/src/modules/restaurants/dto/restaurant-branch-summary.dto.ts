import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { OperatingHourResponseDto } from './operating-hour-response.dto';

export class RestaurantBranchSummaryDto {
  @ApiPropertyOptional()
  id?: string;

  @ApiPropertyOptional()
  name?: string;

  @ApiPropertyOptional()
  addressLine1?: string;

  @ApiPropertyOptional()
  addressLine2?: string;

  @ApiProperty({
    example: 'Bengaluru',
  })
  city: string;

  @ApiPropertyOptional()
  state?: string;

  @ApiPropertyOptional()
  postalCode?: string;

  @ApiPropertyOptional()
  latitude?: number;

  @ApiPropertyOptional()
  longitude?: number;

  @ApiPropertyOptional()
  phone?: string;

  @ApiPropertyOptional({ type: [OperatingHourResponseDto] })
  operatingHours?: OperatingHourResponseDto[];
}
