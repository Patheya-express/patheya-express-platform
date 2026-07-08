import { Module, forwardRef } from '@nestjs/common';

import { DeliveryController } from './controllers/delivery.controller';

import { DeliveryService } from './services/delivery.service';

import { DeliveryRepository } from './repositories/delivery.repository';

import { PresenceModule } from '../presence/presence.module';
import { UsersModule } from '../users/users.module';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [PresenceModule, UsersModule, forwardRef(() => OrdersModule)],

  controllers: [DeliveryController],

  providers: [DeliveryService, DeliveryRepository],

  exports: [DeliveryService],
})
export class DeliveryModule {}
