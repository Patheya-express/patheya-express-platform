import { Module } from '@nestjs/common';

import { UsersModule } from '../users/users.module';
import { RestaurantsModule } from '../restaurants/restaurants.module';
import { DeliveryModule } from '../delivery/delivery.module';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { HealthModule } from '../health/health.module';

import { AdminController } from './controllers/admin.controller';
import { AdminService } from './services/admin.service';

@Module({
  imports: [UsersModule, RestaurantsModule, DeliveryModule, OrdersModule, PaymentsModule, HealthModule],

  controllers: [AdminController],

  providers: [AdminService],
})
export class AdminModule {}
