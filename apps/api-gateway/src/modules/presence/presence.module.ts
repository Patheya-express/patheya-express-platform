import { Module } from '@nestjs/common';

import { PresenceController } from './controllers/presence.controller';

import { PresenceCoreModule } from './presence-core.module';

import { DeliveryCoreModule } from '../delivery/delivery-core.module';

/**
 * HTTP-facing half of the presence feature — controller only. `PresenceService` lives in
 * `PresenceCoreModule`. `PresenceController` itself needs `DeliveryService` too (for its
 * delivery-partner-facing endpoints) — imported directly from `DeliveryCoreModule` rather than
 * the full (controller-bearing) `DeliveryModule`.
 *
 * The previous `forwardRef(() => DeliveryModule)` is no longer needed at the module-import level:
 * that circularity existed because `DeliveryModule` and `PresenceModule` imported each other
 * directly. Now `DeliveryCoreModule` only imports `PresenceCoreModule` (not this module), so
 * `PresenceModule → DeliveryCoreModule` is a one-way edge with no cycle. The controller's own
 * `@Inject(forwardRef(() => DeliveryService))` is untouched (harmless either way, and not a
 * business-logic change).
 */
@Module({
  imports: [PresenceCoreModule, DeliveryCoreModule],

  controllers: [PresenceController],

  exports: [PresenceCoreModule],
})
export class PresenceModule {}
