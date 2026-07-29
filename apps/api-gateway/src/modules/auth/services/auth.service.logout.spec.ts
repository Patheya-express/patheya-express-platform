import { AuthService } from './auth.service';
import { hashToken } from '../../../shared/crypto/crypto.util';

/**
 * Sprint 1.4 — logout's two independent teardown steps: revoking the presented refresh token
 * (durable, DB-backed, always attempted) and best-effort blacklisting the presented access
 * token's jti in Redis (defense-in-depth, must never block logout itself). Only logout() is
 * under test here — the rest of AuthService is unchanged by this sprint and already exercised
 * indirectly elsewhere.
 */
describe('AuthService.logout', () => {
  let authRepository: { revokeRefreshToken: jest.Mock };
  let tokenService: { verifyAccessToken: jest.Mock };
  let redisService: { set: jest.Mock };
  let logger: { log: jest.Mock; warn: jest.Mock };
  let service: AuthService;

  const REFRESH_TOKEN = 'raw-refresh-token';

  beforeEach(() => {
    authRepository = {
      revokeRefreshToken: jest.fn().mockResolvedValue(undefined),
    };
    tokenService = { verifyAccessToken: jest.fn() };
    redisService = { set: jest.fn().mockResolvedValue(undefined) };
    logger = { log: jest.fn(), warn: jest.fn() };

    service = new AuthService(
      authRepository as any,
      {} as any, // passwordService — unused by logout
      tokenService as any,
      {} as any, // auditService — unused by logout
      {} as any, // emailService — unused by logout
      {} as any, // config — unused by logout
      logger as any,
      redisService as any,
    );
  });

  it('always revokes the presented refresh token, by its hash', async () => {
    await service.logout(REFRESH_TOKEN);

    expect(authRepository.revokeRefreshToken).toHaveBeenCalledWith(
      hashToken(REFRESH_TOKEN),
    );
  });

  it('blacklists the presented access token jti in Redis, TTL-ed to its remaining lifetime', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    tokenService.verifyAccessToken.mockResolvedValue({
      sub: 'user-1',
      jti: 'jti-1',
      exp: nowSeconds + 300,
    });

    await service.logout(REFRESH_TOKEN, 'raw-access-token');

    expect(redisService.set).toHaveBeenCalledWith(
      'auth:blacklist:jti-1',
      '1',
      expect.any(Number),
    );
    const [, , ttlUsed] = redisService.set.mock.calls[0] as [
      string,
      string,
      number,
    ];
    expect(ttlUsed).toBeGreaterThan(290);
    expect(ttlUsed).toBeLessThanOrEqual(300);
  });

  it('does not attempt to blacklist anything when no access token was presented', async () => {
    await service.logout(REFRESH_TOKEN);

    expect(tokenService.verifyAccessToken).not.toHaveBeenCalled();
    expect(redisService.set).not.toHaveBeenCalled();
  });

  it('still succeeds, and still revoked the refresh token, when the access token is already invalid/expired', async () => {
    tokenService.verifyAccessToken.mockRejectedValue(new Error('jwt expired'));

    const result = await service.logout(REFRESH_TOKEN, 'stale-access-token');

    expect(result).toEqual({ message: 'Logged out successfully' });
    expect(authRepository.revokeRefreshToken).toHaveBeenCalled();
    expect(redisService.set).not.toHaveBeenCalled();
  });

  it('still succeeds when Redis itself is unavailable during the blacklist attempt', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    tokenService.verifyAccessToken.mockResolvedValue({
      sub: 'user-1',
      jti: 'jti-1',
      exp: nowSeconds + 300,
    });
    redisService.set.mockRejectedValue(new Error('Redis connection refused'));

    const result = await service.logout(REFRESH_TOKEN, 'raw-access-token');

    expect(result).toEqual({ message: 'Logged out successfully' });
    expect(authRepository.revokeRefreshToken).toHaveBeenCalled();
  });

  it('does not blacklist an already-expired jti (ttl <= 0) — nothing left to protect against', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    tokenService.verifyAccessToken.mockResolvedValue({
      sub: 'user-1',
      jti: 'jti-1',
      exp: nowSeconds - 5,
    });

    await service.logout(REFRESH_TOKEN, 'raw-access-token');

    expect(redisService.set).not.toHaveBeenCalled();
  });
});
