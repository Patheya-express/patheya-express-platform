import {
  BadRequestException,
  Injectable,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';

import { ConfigService } from '@nestjs/config';

import { randomBytes } from 'crypto';

import { RegisterDto } from '../dto/register.dto';

import { LoginDto } from '../dto/login.dto';

import { RefreshTokenDto } from '../dto/refresh-token.dto';

import { ForgotPasswordDto } from '../dto/forgot-password.dto';

import { ResetPasswordDto } from '../dto/reset-password.dto';

import { AuthRepository } from '../repositories/auth.repository';

import { PasswordService } from './password.service';

import { TokenService } from './token.service';

import { UserRole, AuditAction } from '@prisma/client';

import { AuditService } from 'src/modules/audit/services/audit.service';

import { EmailService } from '../../email/services/email.service';

import { hashToken } from '../../../shared/crypto/crypto.util';

import { AppLoggerService } from '../../../infrastructure/logger/logger.service';

const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const PASSWORD_RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

/** Always returned as-is regardless of whether the email matched an account or why a reset
 *  token was rejected — never reveals which, to avoid leaking account existence. */
const GENERIC_RESET_MESSAGE =
  'If an account exists for that email, a reset link has been sent.';

@Injectable()
export class AuthService {
  constructor(
    private readonly authRepository: AuthRepository,

    private readonly passwordService: PasswordService,

    private readonly tokenService: TokenService,
    private readonly auditService: AuditService,

    private readonly emailService: EmailService,

    private readonly config: ConfigService,

    private readonly logger: AppLoggerService,
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

      referredByCode: dto.referralCode,
    });

    // Every user gets their own referral code to share — derived from their (already-unique)
    // id rather than generated randomly, so there's no collision-retry to worry about.
    const referralCode = user.id.replace(/-/g, '').slice(0, 8).toUpperCase();

    await this.authRepository.setReferralCode(user.id, referralCode);

    user.referralCode = referralCode;

    if (role === UserRole.CUSTOMER && dto.referralCode) {
      const referrer = await this.authRepository.findUserByReferralCode(
        dto.referralCode,
      );

      if (referrer && referrer.id !== user.id) {
        await this.authRepository.createReferral(referrer.id, user.id);
      }
    }

    const { accessToken, refreshToken } = await this.issueTokens(user);

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
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      passwordHash: _passwordHash,

      ...safeUser
    } = user;

    this.logger.log(
      { event: 'auth_register_success', userId: user.id, role },
      'AuthService',
    );

    return {
      user: safeUser,

      accessToken,

      refreshToken,
    };
  }

  async login(dto: LoginDto) {
    const user = await this.authRepository.findUserByEmail(dto.email);

    if (!user || !user.passwordHash) {
      this.logger.warn(
        { event: 'auth_login_failed', reason: 'user_not_found_or_no_password' },
        'AuthService',
      );

      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await this.passwordService.comparePassword(
      dto.password,

      user.passwordHash,
    );

    if (!isPasswordValid) {
      this.logger.warn(
        {
          event: 'auth_login_failed',
          reason: 'invalid_password',
          userId: user.id,
        },
        'AuthService',
      );

      throw new UnauthorizedException('Invalid credentials');
    }

    const { accessToken, refreshToken } = await this.issueTokens(user);

    const {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      passwordHash: _passwordHash,

      ...safeUser
    } = user;

    this.logger.log(
      { event: 'auth_login_success', userId: user.id },
      'AuthService',
    );

    return {
      user: safeUser,

      accessToken,

      refreshToken,
    };
  }

  /**
   * Validates the refresh token's own JWT signature/expiry AND the DB row's expiry/revocation
   * state (defense in depth — either one alone previously wasn't being checked at all), then
   * rotates it: the presented token is revoked and a brand-new access+refresh pair is issued.
   * A refresh token is therefore single-use — replaying an already-used one always fails, which
   * both bounds a leaked token's lifetime to one use and gives a real signal to later add reuse
   * detection (a revoked token being presented again indicates possible theft).
   */
  async refreshToken(dto: RefreshTokenDto) {
    try {
      await this.tokenService.verifyRefreshToken(dto.refreshToken);
    } catch {
      this.logger.warn(
        { event: 'auth_refresh_failed', reason: 'invalid_or_expired_jwt' },
        'AuthService',
      );

      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const existingToken = await this.authRepository.findRefreshToken(
      hashToken(dto.refreshToken),
    );

    if (!existingToken) {
      this.logger.warn(
        { event: 'auth_refresh_failed', reason: 'token_not_found' },
        'AuthService',
      );

      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (existingToken.revokedAt) {
      // A revoked refresh token being presented again means either a client retried a stale
      // token, or a leaked/stolen token is being replayed after the legitimate rotation already
      // consumed it — a real security signal worth its own distinct event name, even without
      // full reuse-detection (revoke-all-sessions) behavior implemented yet.
      this.logger.warn(
        {
          event: 'auth_refresh_token_reuse_detected',
          userId: existingToken.userId,
        },
        'AuthService',
      );

      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (existingToken.expiresAt.getTime() < Date.now()) {
      this.logger.warn(
        {
          event: 'auth_refresh_failed',
          reason: 'token_expired',
          userId: existingToken.userId,
        },
        'AuthService',
      );

      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    await this.authRepository.revokeRefreshToken(hashToken(dto.refreshToken));

    this.logger.log(
      { event: 'auth_refresh_success', userId: existingToken.userId },
      'AuthService',
    );

    return this.issueTokens(existingToken.user);
  }

  async logout(refreshToken: string) {
    await this.authRepository.revokeRefreshToken(hashToken(refreshToken));

    this.logger.log({ event: 'auth_logout' }, 'AuthService');

    return {
      message: 'Logged out successfully',
    };
  }

  /** Single write path for issuing an access+refresh pair — used by register, login, and
   *  refresh (rotation). The refresh token is only ever stored hashed; the raw value is
   *  returned to the caller exactly once, at issuance. */
  private async issueTokens(user: {
    id: string;
    email: string | null;
    role: UserRole;
  }): Promise<{ accessToken: string; refreshToken: string }> {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const accessToken = await this.tokenService.generateAccessToken(payload);
    const refreshToken = await this.tokenService.generateRefreshToken(payload);

    await this.authRepository.createRefreshToken({
      userId: user.id,
      token: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    });

    return { accessToken, refreshToken };
  }
  /**
   * Always returns the same generic message whether or not the email matched an account —
   * never reveals account existence. If it matched, a single-use, 30-minute token is created
   * (only its hash is stored, same pattern as refresh tokens) and emailed as a reset link. An
   * email-delivery failure is logged, not surfaced to the caller — surfacing it would itself
   * leak "this email exists but delivery failed," and there's nothing the caller could do
   * about an SMTP-level failure anyway.
   */
  async forgotPassword(dto: ForgotPasswordDto): Promise<{ message: string }> {
    const user = await this.authRepository.findUserByEmail(dto.email);

    if (user) {
      const rawToken = randomBytes(32).toString('hex');

      await this.authRepository.createPasswordResetToken({
        userId: user.id,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS),
      });

      const customerAppUrl =
        this.config.get<string>('frontendOrigins.customerApp') ??
        'http://localhost:4200';

      const resetUrl = `${customerAppUrl}/auth/reset-password?token=${rawToken}`;

      try {
        await this.emailService.sendPasswordResetEmail(dto.email, resetUrl);
      } catch (error) {
        // Best-effort — see method doc. The token still exists and remains valid; if the user
        // never receives the email they can simply request another one.
        this.logger.error(
          {
            event: 'auth_password_reset_email_failed',
            message: error instanceof Error ? error.message : 'Unknown error',
          },
          error instanceof Error ? error.stack : undefined,
          'AuthService',
        );
      }
    }

    return { message: GENERIC_RESET_MESSAGE };
  }

  /**
   * Rejects a missing, already-used, or expired token with the same generic error — never
   * reveals which. On success, revokes every refresh token the user currently holds (forces
   * re-login on every other device/session — the standard, expected behavior after a password
   * reset, and reuses the same revoke-all path the account-security surface already exposes).
   */
  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    const tokenHash = hashToken(dto.token);

    const resetToken =
      await this.authRepository.findPasswordResetToken(tokenHash);

    if (
      !resetToken ||
      resetToken.usedAt ||
      resetToken.expiresAt.getTime() < Date.now()
    ) {
      this.logger.warn(
        {
          event: 'auth_password_reset_failed',
          reason: 'invalid_or_expired_token',
        },
        'AuthService',
      );

      throw new BadRequestException('Invalid or expired reset link');
    }

    const passwordHash = await this.passwordService.hashPassword(
      dto.newPassword,
    );

    await this.authRepository.updateUserPassword(
      resetToken.userId,
      passwordHash,
    );
    await this.authRepository.markPasswordResetTokenUsed(tokenHash);
    await this.authRepository.revokeAllRefreshTokensForUser(resetToken.userId);

    await this.auditService.log(
      resetToken.userId,
      'User',
      resetToken.userId,
      AuditAction.UPDATE,
      null,
      { action: 'password_reset' },
    );

    this.logger.log(
      { event: 'auth_password_reset_success', userId: resetToken.userId },
      'AuthService',
    );

    return { message: 'Your password has been reset. Please log in again.' };
  }

  async getProfile(userId: string) {
    const user = await this.authRepository.findUserById(userId);

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash: _passwordHash, ...safeUser } = user;

    return safeUser;
  }

  async revokeAllRefreshTokens(userId: string): Promise<void> {
    await this.authRepository.revokeAllRefreshTokensForUser(userId);
  }
}
