import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TopSellingItemDto {
  @ApiProperty() menuItemId: string;
  @ApiProperty() name: string;
  @ApiProperty() quantitySold: number;
}

export class PeakHourDto {
  @ApiProperty({ example: 19, description: '0-23, in server local time.' })
  hour: number;

  @ApiProperty() orderCount: number;
}

export class RecentOrderSummaryDto {
  @ApiProperty() id: string;
  @ApiProperty() orderNumber: string;
  @ApiProperty() status: string;
  @ApiProperty() totalAmount: number;
  @ApiProperty() customerName: string;
  @ApiProperty() createdAt: Date;
}

/**
 * Every field is computed server-side (see OrdersRepository.getDashboardWindowOrders/
 * getTopSellingItems/getRecentOrders) — the frontend only renders this response, it never
 * aggregates raw order rows itself.
 */
export class RestaurantDashboardResponseDto {
  @ApiProperty() ordersToday: number;
  @ApiProperty() revenueToday: number;

  @ApiProperty({
    description: 'Sum of totalAmount for orders placed in the trailing 7 days.',
  })
  revenueThisWeek: number;

  @ApiProperty({
    description:
      'Sum of totalAmount for orders placed in the trailing 30-day window (not calendar-month-to-date).',
  })
  revenueThisMonth: number;

  @ApiProperty({ description: 'Orders that reached at least CONFIRMED today.' })
  accepted: number;

  @ApiProperty({ description: 'Orders placed today that ended up CANCELLED.' })
  rejected: number;

  @ApiProperty() preparing: number;
  @ApiProperty() ready: number;
  @ApiProperty({ description: 'Orders placed today that reached DELIVERED.' })
  completed: number;

  @ApiPropertyOptional({
    description:
      "Average minutes from placement to READY_FOR_PICKUP, for today's orders that reached it. Null if none did.",
  })
  averagePreparationTimeMinutes?: number;

  @ApiProperty({
    description:
      'accepted / (accepted + rejected) * 100, 0 when nothing has been decided yet.',
  })
  acceptanceRate: number;

  @ApiProperty({ description: 'rejected / ordersToday * 100.' })
  cancellationRate: number;

  @ApiProperty({
    type: [TopSellingItemDto],
    description: 'Rolling 30-day window.',
  })
  topSellingItems: TopSellingItemDto[];

  @ApiProperty({
    type: [PeakHourDto],
    description: 'Rolling 30-day window, hours with at least one order only.',
  })
  peakHours: PeakHourDto[];

  @ApiProperty({ type: [RecentOrderSummaryDto] })
  recentOrders: RecentOrderSummaryDto[];
}
