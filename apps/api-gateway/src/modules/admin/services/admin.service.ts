import { Injectable } from '@nestjs/common';

import { RestaurantStatus, UserRole } from '@prisma/client';

import { UsersService } from '../../users/services/users.service';
import { RestaurantsService } from '../../restaurants/services/restaurants.service';
import { DeliveryService } from '../../delivery/services/delivery.service';
import { OrdersService } from '../../orders/services/orders.service';
import { PaymentsService } from '../../payments/services/payments.service';
import { HealthService } from '../../health/health.service';

import { AdminDashboardResponseDto } from '../dto/admin-dashboard-response.dto';

@Injectable()
export class AdminService {
  constructor(
    private readonly usersService: UsersService,
    private readonly restaurantsService: RestaurantsService,
    private readonly deliveryService: DeliveryService,
    private readonly ordersService: OrdersService,
    private readonly paymentsService: PaymentsService,
    private readonly healthService: HealthService,
  ) {}

  async getDashboard(): Promise<AdminDashboardResponseDto> {
    const [
      totalCustomers,
      totalRestaurants,
      pendingRestaurantApprovals,
      activeDeliveryPartners,
      orderCounts,
      grossRevenueToday,
      health,
    ] = await Promise.all([
      this.usersService.countByRole(UserRole.CUSTOMER),
      this.restaurantsService.countByStatus(),
      this.restaurantsService.countByStatus(RestaurantStatus.PENDING),
      this.deliveryService.countActivePartners(),
      this.ordersService.getDashboardOrderCounts(),
      this.paymentsService.getGrossRevenueToday(),
      this.healthService.getHealthStatus(),
    ]);

    return {
      metrics: {
        totalCustomers,
        totalRestaurants,
        pendingRestaurantApprovals,
        activeDeliveryPartners,
        ordersToday: orderCounts.ordersToday,
        activeOrders: orderCounts.activeOrders,
        completedOrdersToday: orderCounts.completedOrdersToday,
        grossRevenueToday,
      },
      health,
      alerts: [],
      notifications: [],
    };
  }
}
