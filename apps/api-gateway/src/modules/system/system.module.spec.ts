import { GUARDS_METADATA } from '@nestjs/common/constants';
import { UserRole } from '@prisma/client';

import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SystemController } from './controllers/system.controller';
import { SystemModule, systemModulesFor } from './system.module';

describe('System smoke-test endpoints (/system/*)', () => {
  it('are not registered at all in production', () => {
    expect(systemModulesFor('production')).toEqual([]);
  });

  it.each(['development', 'staging', undefined])(
    'are registered outside production (%p)',
    (nodeEnv) => {
      expect(systemModulesFor(nodeEnv)).toEqual([SystemModule]);
    },
  );

  it('require an authenticated ADMIN or SUPER_ADMIN wherever they are registered', () => {
    const guards: unknown = Reflect.getMetadata(
      GUARDS_METADATA,
      SystemController,
    );
    expect(guards).toEqual([JwtAuthGuard, RolesGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, SystemController)).toEqual([
      UserRole.ADMIN,
      UserRole.SUPER_ADMIN,
    ]);
  });
});
