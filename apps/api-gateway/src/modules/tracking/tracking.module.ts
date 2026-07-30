import { Module } from '@nestjs/common';

import { TrackingController } from './controllers/tracking.controller';

import { TrackingService } from './services/tracking.service';

import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [OrdersModule],

  controllers: [TrackingController],

  providers: [TrackingService],

  exports: [TrackingService],
})
export class TrackingModule {}
