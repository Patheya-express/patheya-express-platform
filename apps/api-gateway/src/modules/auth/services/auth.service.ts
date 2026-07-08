import {
  Injectable,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';

import { RegisterDto } from '../dto/register.dto';

import { LoginDto } from '../dto/login.dto';

import { RefreshTokenDto } from '../dto/refresh-token.dto';

import { AuthRepository } from '../repositories/auth.repository';

import { PasswordService } from './password.service';

import { TokenService } from './token.service';

import { UserRole, AuditAction } from '@prisma/client';

import { AuditService } from 'src/modules/audit/services/audit.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly authRepository: AuthRepository,

    private readonly passwordService: PasswordService,

    private readonly tokenService: TokenService,
    private readonly auditService: AuditService,
  ) {}

  async register(dto: RegisterDto) {
    return this.registerWithRole(dto, UserRole.CUSTOMER);
  }

  async registerDeliveryPartner(dto: RegisterDto) {
    return this.registerWithRole(dto, UserRole.DELIVERY_PARTNER);
  }

  async registerRestaurantOwner(dto: RegisterDto) {
    return this.registerWithRole(dto, UserRole.RESTAURANT_OWNER);
  }

  private async registerWithRole(dto: RegisterDto, role: UserRole) {
    const existingUser = await this.authRepository.findUserByEmail(dto.email);

    if (existingUser) {
      throw new ConflictException('User already exists');
    }

    const passwordHash = await this.passwordService.hashPassword(dto.password);

    const user = await this.authRepository.createUser({
      firstName: dto.firstName,

      lastName: dto.lastName,

      email: dto.email,

      passwordHash,

      role,
    });

    const payload = {
      sub: user.id,

      email: user.email,

      role: user.role,
    };

    const accessToken = await this.tokenService.generateAccessToken(payload);

    const refreshToken = await this.tokenService.generateRefreshToken(payload);

    await this.authRepository.createRefreshToken({
      userId: user.id,

      token: refreshToken,

      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    await this.auditService.log(
      user.id,

      'User',

      user.id,

      AuditAction.CREATE,

      null,

      {
        email: user.email,
      },
    );

    const {
      passwordHash: _passwordHash,

      ...safeUser
    } = user;

    return {
      user: safeUser,

      accessToken,

      refreshToken,
    };
  }

  async login(dto: LoginDto) {
    const user = await this.authRepository.findUserByEmail(dto.email);

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await this.passwordService.comparePassword(
      dto.password,

      user.passwordHash,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload = {
      sub: user.id,

      email: user.email,

      role: user.role,
    };

    const accessToken = await this.tokenService.generateAccessToken(payload);

    const refreshToken = await this.tokenService.generateRefreshToken(payload);

    await this.authRepository.createRefreshToken({
      userId: user.id,

      token: refreshToken,

      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    const {
      passwordHash: _passwordHash,

      ...safeUser
    } = user;

    return {
      user: safeUser,

      accessToken,

      refreshToken,
    };
  }

  async refreshToken(dto: RefreshTokenDto) {
    const existingToken = await this.authRepository.findRefreshToken(
      dto.refreshToken,
    );

    if (!existingToken || existingToken.revokedAt) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const payload = {
      sub: existingToken.user.id,

      email: existingToken.user.email,

      role: existingToken.user.role,
    };

    const accessToken = await this.tokenService.generateAccessToken(payload);

    return {
      accessToken,
    };
  }

  async logout(refreshToken: string) {
    await this.authRepository.revokeRefreshToken(refreshToken);

    return {
      message: 'Logged out successfully',
    };
  }
  async getProfile(userId: string) {
    const user = await this.authRepository.findUserById(userId);

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const { passwordHash: _passwordHash, ...safeUser } = user;

    return safeUser;
  }

  async revokeAllRefreshTokens(userId: string): Promise<void> {
    await this.authRepository.revokeAllRefreshTokensForUser(userId);
  }
}
