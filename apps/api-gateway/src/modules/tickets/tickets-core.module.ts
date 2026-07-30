import { Module } from '@nestjs/common';

import { TicketsRepository } from './repositories/tickets.repository';

/**
 * Controller-free core of the tickets feature — `TicketsRepository`, shared as-is (not
 * duplicated) by both `TicketsModule` (HTTP, via `TicketsService`) and `TicketsWorkerModule`
 * (`TicketEscalationProcessor`). Splitting this out lets the worker-side module depend on the
 * repository without also pulling `TicketsController`/`FaqController` into the worker process's
 * HTTP surface.
 */
@Module({
  providers: [TicketsRepository],

  exports: [TicketsRepository],
})
export class TicketsCoreModule {}
