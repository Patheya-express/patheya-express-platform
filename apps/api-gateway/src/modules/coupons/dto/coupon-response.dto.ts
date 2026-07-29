import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { CouponType, CouponScope } from '@prisma/client';

export class CouponResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  code: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional()
  description?: string;

  @ApiProperty({ enum: CouponType })
  type: CouponType;

  @ApiProperty()
  value: number;

  @ApiPropertyOptional()
  maxDiscountAmount?: number;

  @ApiProperty()
  minOrderAmount: number;

  @ApiProperty({ enum: CouponScope })
  scope: CouponScope;

  @ApiPropertyOptional()
  restaurantId?: string;

  @ApiPropertyOptional()
  usageLimit?: number;

  @ApiProperty()
  usagePerUser: number;

  @ApiProperty()
  totalUsed: number;

  @ApiProperty()
  startsAt: Date;

  @ApiProperty()
  endsAt: Date;

  @ApiProperty()
  active: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
