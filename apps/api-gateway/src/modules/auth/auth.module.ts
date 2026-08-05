import { Module } from '@nestjs/common';

import { PassportModule } from '@nestjs/passport';

import { JwtStrategy } from './strategies/jwt.strategy';

import { AuthController } from './controllers/auth.controller';

import { RolesGuard } from './guards/roles.guard';

import { AuthCoreModule } from './auth-core.module';

/**
 * HTTP-facing half of the auth feature — controller, Passport strategy, and the roles guard,
 * none of which are needed outside HTTP request handling. Business logic (`AuthService`/
 * `PasswordService`/`TokenService`/`AuthRepository`) lives in `AuthCoreModule`, re-exported here
 * so existing consumers of `AuthModule` (`UsersModule`, `DeliveryModule`, etc.) keep working
 * unchanged.
 */
@Module({
  imports: [PassportModule, AuthCoreModule],

  controllers: [AuthController],

  providers: [JwtStrategy, RolesGuard],

  exports: [AuthCoreModule],
})
export class AuthModule {}
