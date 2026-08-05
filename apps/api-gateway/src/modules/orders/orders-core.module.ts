import { Module, forwardRef } from '@nestjs/common';

import { OrdersService } from './services/orders.service';

import { OrdersRepository } from './repositories/orders.repository';

import { OrderPaymentListener } from './listeners/order-payment.listener';

import { DeliveryCoreModule } from '../delivery/delivery-core.module';
import { PaymentsCoreModule } from '../payments/payments-core.module';
import { RestaurantsCoreModule } from '../restaurants/restaurants-core.module';
import { AddressesCoreModule } from '../addresses/addresses-core.module';
import { AuditCoreModule } from '../audit/audit-core.module';
import { PricingModule } from '../pricing/pricing.module';
import { CouponsCoreModule } from '../coupons/coupons-core.module';

/**
 * Controller-free core of the orders feature — `OrdersService`/`OrdersRepository`, needed
 * directly by `OrderAcceptanceTimeoutProcessor` (BullMQ), plus `OrderPaymentListener` (subscribes
 * to `payment.success`/`payment.failed` and calls back into `OrdersService`, so it must keep
 * running wherever `OrdersService` does). `forwardRef` on `DeliveryCoreModule` mirrors the
 * genuine mutual dependency `OrdersService` <-> `DeliveryService` had before this split — both
 * still need each other, just via their Core modules now. Kept separate from `OrdersModule`
 * (which owns `OrdersController`) so importing it never pulls a controller into the Worker
 * process. `PricingModule` has no controller of its own, so it's imported as-is (unchanged).
 */
@Module({
  imports: [
    forwardRef(() => DeliveryCoreModule),
    PaymentsCoreModule,
    RestaurantsCoreModule,
    AddressesCoreModule,
    AuditCoreModule,
    PricingModule,
    CouponsCoreModule,
  ],

  providers: [OrdersService, OrdersRepository, OrderPaymentListener],

  exports: [OrdersService, OrdersRepository],
})
export class OrdersCoreModule {}
