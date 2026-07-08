import { Module, forwardRef } from '@nestjs/common';

import { OrdersController } from './controllers/orders.controller';

import { OrdersService } from './services/orders.service';

import { OrdersRepository } from './repositories/orders.repository';

import { OrderPaymentListener } from './listeners/order-payment.listener';

import { DeliveryModule } from '../delivery/delivery.module';
import { PaymentsModule } from '../payments/payments.module';
import { RestaurantsModule } from '../restaurants/restaurants.module';
import { AddressesModule } from '../addresses/addresses.module';

@Module({
  imports: [
    forwardRef(() => DeliveryModule),
    PaymentsModule,
    RestaurantsModule,
    AddressesModule,
  ],

  controllers: [OrdersController],

  providers: [OrdersService, OrdersRepository, OrderPaymentListener],

  exports: [OrdersService],
})
export class OrdersModule {}
