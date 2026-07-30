import { Module } from '@nestjs/common';

import { OrdersController } from './controllers/orders.controller';

import { OrdersCoreModule } from './orders-core.module';

/**
 * HTTP-facing half of the orders feature — controller only. Business logic (`OrdersService`/
 * `OrdersRepository`/`OrderPaymentListener`) lives in `OrdersCoreModule`, re-exported here so
 * existing consumers of `OrdersModule` keep working unchanged. This module (and its transitive
 * imports, `DeliveryModule` among them) is now only ever reachable from `AppModule` —
 * `QueueWorkerModule`/`DeliveryCoreModule`/etc. all depend on `OrdersCoreModule` directly, never
 * this module, which is what keeps `OrdersController` (and everything `DeliveryModule` pulls in)
 * out of the Worker process.
 */
@Module({
  imports: [OrdersCoreModule],

  controllers: [OrdersController],

  exports: [OrdersCoreModule],
})
export class OrdersModule {}
