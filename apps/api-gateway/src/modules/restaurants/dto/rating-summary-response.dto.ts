import { ApiProperty } from '@nestjs/swagger';

export class RatingBreakdownEntryDto {
  @ApiProperty({ example: 5, minimum: 1, maximum: 5 })
  rating: number;

  @ApiProperty({ example: 42 })
  count: number;
}

export class RatingSummaryResponseDto {
  @ApiProperty({ example: 4.3 })
  averageRating: number;

  @ApiProperty({ example: 128 })
  totalReviews: number;

  @ApiProperty({
    type: [RatingBreakdownEntryDto],
    description:
      'One entry per star rating 1-5, in descending order, count 0 if none.',
  })
  breakdown: RatingBreakdownEntryDto[];
}
