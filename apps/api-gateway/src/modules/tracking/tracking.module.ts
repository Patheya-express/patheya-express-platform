import { Module } from '@nestjs/common';

import { TrackingController } from './controllers/tracking.controller';

import { TrackingService } from './services/tracking.service';

@Module({
  controllers: [TrackingController],

  providers: [TrackingService],

  exports: [TrackingService],
})
export class TrackingModule {}
