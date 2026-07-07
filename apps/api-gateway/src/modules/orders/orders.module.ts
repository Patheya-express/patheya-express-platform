import { Module } from '@nestjs/common';

import { OrdersController } from './controllers/orders.controller';

import { OrdersService } from './services/orders.service';

import { OrdersRepository } from './repositories/orders.repository';

import { DeliveryModule } from '../delivery/delivery.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [DeliveryModule, PaymentsModule],

  controllers: [OrdersController],

  providers: [OrdersService, OrdersRepository],

  exports: [OrdersService],
})
export class OrdersModule {}
