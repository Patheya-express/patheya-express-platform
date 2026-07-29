import { ApiProperty } from '@nestjs/swagger';

/**
 * Swagger-documented mirror of the `PricingResult` interface (see `pricing-result.dto.ts`) — kept
 * as a separate class because interfaces carry no reflection metadata for `@nestjs/swagger` to
 * read; any endpoint returning a pricing preview (e.g. coupon validation) reuses this one class
 * instead of redeclaring the same fields.
 */
export class PricingBreakdownEntryResponseDto {
  @ApiProperty()
  label: string;

  @ApiProperty()
  amount: number;
}

export class PricingResultResponseDto {
  @ApiProperty()
  subtotal: number;

  @ApiProperty()
  deliveryFee: number;

  @ApiProperty()
  taxAmount: number;

  @ApiProperty()
  discountAmount: number;

  @ApiProperty()
  walletAmount: number;

  @ApiProperty()
  platformFee: number;

  @ApiProperty()
  totalAmount: number;

  @ApiProperty({ type: [PricingBreakdownEntryResponseDto] })
  pricingBreakdown: PricingBreakdownEntryResponseDto[];
}
