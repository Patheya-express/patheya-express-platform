import { Module } from '@nestjs/common';

import { DispatchController } from './controllers/dispatch.controller';

import { DispatchService } from './services/dispatch.service';

import { DispatchRepository } from './repositories/dispatch.repository';

import { DispatchListener } from './listeners/dispatch.listener';
import { PresenceModule } from '../presence/presence.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [PresenceModule, AuditModule],

  controllers: [DispatchController],

  providers: [DispatchService, DispatchRepository, DispatchListener],

  exports: [DispatchService, DispatchRepository],
})
export class DispatchModule {}
