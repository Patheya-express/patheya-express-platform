import { Module } from '@nestjs/common';

import { UsersController } from './controllers/users.controller';

import { UsersCoreModule } from './users-core.module';

/**
 * HTTP-facing half of the users feature — controller only. `UsersService`/`UsersRepository`
 * live in `UsersCoreModule`, re-exported here so existing consumers of `UsersModule` keep
 * working unchanged.
 */
@Module({
  imports: [UsersCoreModule],

  controllers: [UsersController],

  exports: [UsersCoreModule],
})
export class UsersModule {}
