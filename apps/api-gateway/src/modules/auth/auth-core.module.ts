import { Module } from '@nestjs/common';

import { JwtModule } from '@nestjs/jwt';

import { PasswordService } from './services/password.service';

import { TokenService } from './services/token.service';

import { AuthService } from './services/auth.service';

import { AuthRepository } from './repositories/auth.repository';

import { AuditCoreModule } from '../audit/audit-core.module';
import { EmailModule } from '../email/email.module';

/**
 * Controller-free core of the auth feature — `PasswordService`/`TokenService`/`AuthService`/
 * `AuthRepository`, needed by `UsersCoreModule` (`UsersService` injects `PasswordService`/
 * `AuthService`) and by `DeliveryModule`'s `ProofService` (OTP hashing, reused from
 * `PasswordService`). Kept separate from `AuthModule` (which owns `AuthController`,
 * `JwtStrategy`, `RolesGuard`, `PassportModule` — none needed outside HTTP request handling) so
 * importing it never pulls a controller into the Worker process. `EmailModule` has no controller
 * of its own, so it's imported as-is (unchanged).
 */
@Module({
  imports: [JwtModule.register({}), AuditCoreModule, EmailModule],

  providers: [PasswordService, TokenService, AuthService, AuthRepository],

  exports: [PasswordService, TokenService, AuthService, JwtModule],
})
export class AuthCoreModule {}
