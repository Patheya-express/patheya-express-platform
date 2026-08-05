import { Module } from '@nestjs/common';

import { DispatchController } from './controllers/dispatch.controller';

import { DispatchCoreModule } from './dispatch-core.module';

/**
 * HTTP-facing half of the dispatch feature — controller only. `DispatchService`/
 * `DispatchRepository`/`DispatchListener` live in `DispatchCoreModule`, re-exported here so
 * existing consumers of `DispatchModule` keep working unchanged.
 */
@Module({
  imports: [DispatchCoreModule],

  controllers: [DispatchController],

  exports: [DispatchCoreModule],
})
export class DispatchModule {}
