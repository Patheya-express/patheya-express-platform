import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { OrderStatus } from '@prisma/client';

import { DeliveryCustomerSummaryDto } from './delivery-customer-summary.dto';

import { AssignmentRestaurantSummaryDto } from './assignment-restaurant-summary.dto';

import { AssignmentBranchSummaryDto } from './assignment-branch-summary.dto';

import { AssignmentOrderItemSummaryDto } from './assignment-order-item-summary.dto';

export class AssignmentOrderSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  orderNumber: string;

  @ApiProperty({
    enum: OrderStatus,
  })
  status: OrderStatus;

  @ApiProperty()
  totalAmount: number;

  @ApiProperty()
  deliveryFee: number;

  @ApiProperty()
  deliveryAddress: string;

  @ApiPropertyOptional()
  latitude?: number;

  @ApiPropertyOptional()
  longitude?: number;

  @ApiPropertyOptional()
  notes?: string;

  @ApiPropertyOptional({
    type: () => DeliveryCustomerSummaryDto,
  })
  customer?: DeliveryCustomerSummaryDto;

  @ApiPropertyOptional({
    type: () => AssignmentRestaurantSummaryDto,
  })
  restaurant?: AssignmentRestaurantSummaryDto;

  @ApiPropertyOptional({
    type: () => AssignmentBranchSummaryDto,
  })
  branch?: AssignmentBranchSummaryDto;

  @ApiProperty({
    type: () => [AssignmentOrderItemSummaryDto],
  })
  items: AssignmentOrderItemSummaryDto[];
}
