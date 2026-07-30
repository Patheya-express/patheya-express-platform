import { ApiProperty } from '@nestjs/swagger';

import { PricingResultResponseDto } from '../../pricing/dto/pricing-result-response.dto';

import { CouponResponseDto } from './coupon-response.dto';

export class CouponValidationResponseDto {
  @ApiProperty({ type: CouponResponseDto })
  coupon: CouponResponseDto;

  @ApiProperty({
    type: PricingResultResponseDto,
    description:
      'What the order total would look like if this coupon were applied right now.',
  })
  pricing: PricingResultResponseDto;
}
