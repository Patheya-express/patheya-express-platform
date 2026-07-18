import { Module } from '@nestjs/common';

import { UsersModule } from '../users/users.module';
import { RestaurantsModule } from '../restaurants/restaurants.module';
import { DeliveryModule } from '../delivery/delivery.module';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { HealthModule } from '../health/health.module';
import { DispatchModule } from '../dispatch/dispatch.module';
import { PresenceModule } from '../presence/presence.module';
import { AuditModule } from '../audit/audit.module';

import { AdminController } from './controllers/admin.controller';
import { AdminDispatchController } from './controllers/admin-dispatch.controller';
import { AdminService } from './services/admin.service';
import { AdminDispatchService } from './services/admin-dispatch.service';
import { AdminBootstrapModule } from './bootstrap/admin-bootstrap.module';

@Module({
  imports: [
    UsersModule,
    RestaurantsModule,
    DeliveryModule,
    OrdersModule,
    PaymentsModule,
    HealthModule,
    // Manual dispatch-assignment support (Phase 9) — GET /admin/delivery-partners/available and
    // POST /admin/orders/:orderId/assign, both in AdminDispatchController/AdminDispatchService.
    DispatchModule,
    PresenceModule,
    AuditModule,
    // Internal-only: creates the first SUPER_ADMIN on startup if one doesn't exist yet. No
    // controller, no route, nothing Swagger/GraphQL ever exposes — see
    // docs/deployment/render-blueprint.md's Super Admin bootstrap section.
    AdminBootstrapModule,
  ],

  controllers: [AdminController, AdminDispatchController],

  providers: [AdminService, AdminDispatchService],
})
export class AdminModule {}
