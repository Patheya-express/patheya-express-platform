import { Module } from '@nestjs/common';

import { DeliveryController } from './controllers/delivery.controller';

import { DeliveryService } from './services/delivery.service';

import { DeliveryRepository } from './repositories/delivery.repository';

import { PresenceModule } from '../presence/presence.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [PresenceModule, UsersModule],

  controllers: [DeliveryController],

  providers: [DeliveryService, DeliveryRepository],

  exports: [DeliveryService],
})
export class DeliveryModule {}
