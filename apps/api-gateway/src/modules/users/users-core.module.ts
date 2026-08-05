import { Module } from '@nestjs/common';

import { UsersService } from './services/users.service';

import { UsersRepository } from './repositories/users.repository';

import { AuthCoreModule } from '../auth/auth-core.module';
import { AuditCoreModule } from '../audit/audit-core.module';

/**
 * Controller-free core of the users feature — needed by `DeliveryCoreModule` (`DeliveryService`
 * injects `UsersService` directly). Kept separate from `UsersModule` (which owns
 * `UsersController`) so importing it never pulls a controller into the Worker process.
 */
@Module({
  imports: [AuthCoreModule, AuditCoreModule],

  providers: [UsersService, UsersRepository],

  exports: [UsersService, UsersRepository],
})
export class UsersCoreModule {}
