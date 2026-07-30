import { Module } from '@nestjs/common';

import { DispatchService } from './services/dispatch.service';

import { DispatchRepository } from './repositories/dispatch.repository';

import { DispatchListener } from './listeners/dispatch.listener';

import { PresenceCoreModule } from '../presence/presence-core.module';
import { AuditCoreModule } from '../audit/audit-core.module';

/**
 * Controller-free core of the dispatch feature. Includes `DispatchListener` alongside the
 * service/repository — it subscribes to `dispatch.assignment.expired` (published by
 * `AssignmentExpiryProcessor`, which runs in this same Worker process) to trigger
 * `DispatchService.assignOrder()`'s automatic re-dispatch, so it must keep running in the
 * Worker exactly as it does today. Kept separate from `DispatchModule` (which owns
 * `DispatchController`) so importing it never pulls a controller into the Worker process.
 */
@Module({
  imports: [PresenceCoreModule, AuditCoreModule],

  providers: [DispatchService, DispatchRepository, DispatchListener],

  exports: [DispatchService, DispatchRepository],
})
export class DispatchCoreModule {}
