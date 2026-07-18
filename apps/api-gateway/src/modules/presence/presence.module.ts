import { Module, forwardRef } from '@nestjs/common';

import { PresenceController } from './controllers/presence.controller';

import { PresenceService } from './services/presence.service';

import { DeliveryModule } from '../delivery/delivery.module';

@Module({
  imports: [forwardRef(() => DeliveryModule)],

  controllers: [PresenceController],

  providers: [PresenceService],

  exports: [PresenceService],
})
export class PresenceModule {}
