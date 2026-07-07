import { Module } from '@nestjs/common';

import { JwtModule } from '@nestjs/jwt';

import { PassportModule } from '@nestjs/passport';

import { JwtStrategy } from './strategies/jwt.strategy';

import { PasswordService } from './services/password.service';

import { TokenService } from './services/token.service';

import { AuthService } from './services/auth.service';

import { AuthRepository } from './repositories/auth.repository';

import { AuthController } from './controllers/auth.controller';

import { RolesGuard } from './guards/roles.guard';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [PassportModule, JwtModule.register({}), AuditModule],

  controllers: [AuthController],

  providers: [
    JwtStrategy,

    PasswordService,

    TokenService,

    AuthService,

    AuthRepository,

    RolesGuard,
  ],

  exports: [PasswordService, TokenService, JwtModule],
})
export class AuthModule {}
