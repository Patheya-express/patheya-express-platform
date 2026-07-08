import { ApiProperty } from '@nestjs/swagger';

import { OfferResponseDto } from './offer-response.dto';

export class PaginatedOffersResponseDto {
  @ApiProperty({ type: [OfferResponseDto] })
  items: OfferResponseDto[];

  @ApiProperty({ example: 42 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 3 })
  totalPages: number;
}
