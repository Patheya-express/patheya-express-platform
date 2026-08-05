import { Injectable, Optional, UnauthorizedException } from '@nestjs/common';

import { PassportStrategy } from '@nestjs/passport';

import { ExtractJwt, Strategy } from 'passport-jwt';

import { RedisService } from '../../../infrastructure/redis/redis.service';

import { AppLoggerService } from '../../../infrastructure/logger/logger.service';

interface AccessTokenPayload {
  sub: string;
  email: string | null;
  role: string;
  jti?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly redisService: RedisService,

    // Optional so jwt.strategy.spec.ts's `new JwtStrategy(redisService)` (one arg) keeps working.
    @Optional()
    private readonly logger?: AppLoggerService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),

      ignoreExpiration: false,

      secretOrKey: process.env.JWT_ACCESS_SECRET as string,
    });
  }

  /**
   * Runs on every authenticated request. Two lightweight Redis lookups (not a DB query) close
   * the two gaps a stateless, signature-only JWT otherwise leaves open:
   *  - `auth:blacklist:<jti>` — set by AuthService.logout() for the specific access token that
   *    was just logged out (TTL'd to that token's own remaining lifetime, so the key never
   *    outlives the token it guards).
   *  - `auth:blocked:<userId>` — set by UsersService.suspendUser()/blockUser() (cleared by
   *    activateUser()/restoreUser()), so a suspended/blocked account's already-issued access
   *    tokens stop working within one Redis round-trip rather than surviving up to their full
   *    15-minute lifetime.
   * Both keys are looked up in parallel. If Redis itself is unavailable, this fails OPEN (logs
   * and allows the request through on signature/expiry alone, same as before this existed) —
   * matching this codebase's established Redis-resiliency convention elsewhere (see
   * RedisService.tryLock's doc comment): a cache/optimization outage must never take down the
   * whole API, and the JWT's own signature+expiry check still applies regardless.
   */
  async validate(payload: AccessTokenPayload) {
    let blacklisted: string | null = null;
    let blocked: string | null = null;

    try {
      [blacklisted, blocked] = await Promise.all([
        payload.jti
          ? this.redisService.get(`auth:blacklist:${payload.jti}`)
          : Promise.resolve(null),
        this.redisService.get(`auth:blocked:${payload.sub}`),
      ]);
    } catch (error) {
      // Redis unavailable — fail open, see doc comment above. Production Readiness Stage D
      // (Logging Audit): this previously had no log call at all, despite the doc comment above
      // claiming "logs and allows the request through" — an auth-enforcement path silently
      // degrading (blacklist/blocked checks stop being enforced) had zero log trail.
      this.logger?.warn(
        {
          event: 'jwt_strategy_redis_check_failed',
          userId: payload.sub,
          reason: error instanceof Error ? error.message : String(error),
        },
        'JwtStrategy',
      );
    }

    if (blacklisted) {
      this.logger?.warn(
        { event: 'auth_token_rejected_blacklisted', userId: payload.sub },
        'JwtStrategy',
      );

      throw new UnauthorizedException('Session has been logged out');
    }

    if (blocked) {
      this.logger?.warn(
        { event: 'auth_token_rejected_account_blocked', userId: payload.sub },
        'JwtStrategy',
      );

      throw new UnauthorizedException('Account is no longer active');
    }

    return {
      userId: payload.sub,

      email: payload.email,

      role: payload.role,

      jti: payload.jti,
    };
  }
}
