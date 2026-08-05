import { Module } from '@nestjs/common';

import { PresenceService } from './services/presence.service';

/**
 * Controller-free core of the presence feature — needed by `DispatchCoreModule` (`DispatchService`
 * injects `PresenceService` directly) and by `DeliveryCoreModule` (`DeliveryService` does too).
 * Kept separate from `PresenceModule` (which owns `PresenceController`) so importing it never
 * pulls a controller into the Worker process. `PresenceService` itself only depends on the
 * global `RedisService`, so no imports are needed here.
 */
@Module({
  providers: [PresenceService],

  exports: [PresenceService],
})
export class PresenceCoreModule {}
