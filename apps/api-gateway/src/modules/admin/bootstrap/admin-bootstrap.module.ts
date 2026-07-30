import { Module } from '@nestjs/common';

import { AuthModule } from '../../auth/auth.module';

import { AdminBootstrapService } from './admin-bootstrap.service';

/**
 * Internal-only module — no controller, no exported service, nothing routable. Its single
 * provider runs itself automatically via `OnApplicationBootstrap` the moment this module is part
 * of the graph; nothing else in the application ever needs to inject `AdminBootstrapService`
 * directly, which is why it's neither exported nor referenced anywhere outside this file's own
 * registration in `AdminModule`.
 */
@Module({
  imports: [AuthModule],

  providers: [AdminBootstrapService],
})
export class AdminBootstrapModule {}
