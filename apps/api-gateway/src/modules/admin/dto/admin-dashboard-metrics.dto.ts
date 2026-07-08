import { ApiProperty } from '@nestjs/swagger';

export class AdminDashboardMetricsDto {
  @ApiProperty({
    example: 1280,
    description: 'Total number of users with the CUSTOMER role',
  })
  totalCustomers: number;

  @ApiProperty({
    example: 96,
    description: 'Total number of restaurants, regardless of approval status',
  })
  totalRestaurants: number;

  @ApiProperty({
    example: 4,
    description: 'Number of restaurants awaiting approval',
  })
  pendingRestaurantApprovals: number;

  @ApiProperty({
    example: 32,
    description:
      'Number of delivery partners currently AVAILABLE or ON_DELIVERY',
  })
  activeDeliveryPartners: number;

  @ApiProperty({
    example: 214,
    description: 'Number of orders placed today',
  })
  ordersToday: number;

  @ApiProperty({
    example: 18,
    description: 'Number of orders currently in a non-terminal status',
  })
  activeOrders: number;

  @ApiProperty({
    example: 190,
    description: 'Number of orders delivered today',
  })
  completedOrdersToday: number;

  @ApiProperty({
    example: 45600.5,
    description: 'Sum of successful payments captured today',
  })
  grossRevenueToday: number;
}
