import { Module } from '@nestjs/common';

import { UsersModule } from '../users/users.module';
import { RestaurantsModule } from '../restaurants/restaurants.module';
import { DeliveryModule } from '../delivery/delivery.module';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { HealthModule } from '../health/health.module';

import { AdminController } from './controllers/admin.controller';
import { AdminService } from './services/admin.service';
import { AdminBootstrapModule } from './bootstrap/admin-bootstrap.module';

@Module({
  imports: [
    UsersModule,
    RestaurantsModule,
    DeliveryModule,
    OrdersModule,
    PaymentsModule,
    HealthModule,
    // Internal-only: creates the first SUPER_ADMIN on startup if one doesn't exist yet. No
    // controller, no route, nothing Swagger/GraphQL ever exposes — see
    // docs/deployment/render-blueprint.md's Super Admin bootstrap section.
    AdminBootstrapModule,
  ],

  controllers: [AdminController],

  providers: [AdminService],
})
export class AdminModule {}
