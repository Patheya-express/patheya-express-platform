import { Module } from '@nestjs/common';

import { AuditController } from './controllers/audit.controller';

import { AuditCoreModule } from './audit-core.module';

/**
 * HTTP-facing half of the audit feature — controller only. `AuditService`/`AuditRepository` live
 * in `AuditCoreModule`. Re-exports it so existing consumers of `AuditModule` keep working
 * unchanged; anything reachable from the Worker process now imports `AuditCoreModule` directly.
 */
@Module({
  imports: [AuditCoreModule],

  controllers: [AuditController],

  exports: [AuditCoreModule],
})
export class AuditModule {}
