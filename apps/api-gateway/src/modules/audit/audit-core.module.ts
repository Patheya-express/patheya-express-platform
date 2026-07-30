import { Module } from '@nestjs/common';

import { AuditService } from './services/audit.service';

import { AuditRepository } from './repositories/audit.repository';

/**
 * Controller-free core of the audit feature — `AuditService`/`AuditRepository`, needed by many
 * other Core modules (Dispatch, Orders, Delivery, Restaurants, Users, Auth, ...) since audit
 * logging happens on both the HTTP path and inside Worker-resident business logic. Kept separate
 * from `AuditModule` (which owns `AuditController`) so importing it never pulls a controller
 * into the Worker process.
 */
@Module({
  providers: [AuditService, AuditRepository],

  exports: [AuditService, AuditRepository],
})
export class AuditCoreModule {}
