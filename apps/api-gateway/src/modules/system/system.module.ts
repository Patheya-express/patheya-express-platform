import { Module, Type } from '@nestjs/common';

import { SystemController } from './controllers/system.controller';
import { PresenceModule } from '../presence/presence.module';

@Module({
  imports: [PresenceModule],

  controllers: [SystemController],
})
export class SystemModule {}

/**
 * `SystemController` holds connectivity smoke-test utilities (`redis-test` writes a Redis key,
 * `queue-test` enqueues a BullMQ job). Nothing in the platform calls them — the deploy smoke test
 * (scripts/smoke-test.ts) uses `/health/ready` and `/metrics` instead — so they are not registered
 * at all in production. Outside production they stay available for debugging, behind an
 * ADMIN/SUPER_ADMIN guard (QA/staging are internet-facing too).
 */
export function systemModulesFor(nodeEnv: string | undefined): Type[] {
  return nodeEnv === 'production' ? [] : [SystemModule];
}
