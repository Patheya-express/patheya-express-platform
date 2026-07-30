import { ApiProperty } from '@nestjs/swagger';

import { AvailableDeliveryPartnerResponseDto } from './available-delivery-partner-response.dto';

export class PaginatedAvailableDeliveryPartnersResponseDto {
  @ApiProperty({ type: AvailableDeliveryPartnerResponseDto, isArray: true })
  items: AvailableDeliveryPartnerResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;

  @ApiProperty()
  totalPages: number;
}
