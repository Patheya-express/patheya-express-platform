import { UnauthorizedException } from '@nestjs/common';

import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  let redisService: { get: jest.Mock };
  let strategy: JwtStrategy;

  const payload = {
    sub: 'user-1',
    email: 'user@example.com',
    role: 'CUSTOMER',
    jti: 'token-1',
  };

  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET = 'test-secret';

    redisService = { get: jest.fn().mockResolvedValue(null) };
    strategy = new JwtStrategy(redisService as any);
  });

  it('accepts a token whose jti is not blacklisted and whose user is not blocked', async () => {
    const result = await strategy.validate(payload);

    expect(result).toEqual({
      userId: 'user-1',
      email: 'user@example.com',
      role: 'CUSTOMER',
      jti: 'token-1',
    });
    expect(redisService.get).toHaveBeenCalledWith('auth:blacklist:token-1');
    expect(redisService.get).toHaveBeenCalledWith('auth:blocked:user-1');
  });

  it('rejects a token whose jti has been blacklisted by logout', async () => {
    redisService.get.mockImplementation((key: string) =>
      Promise.resolve(key === 'auth:blacklist:token-1' ? '1' : null),
    );

    await expect(strategy.validate(payload)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a token belonging to a suspended/blocked user even though the token itself is unexpired and unblacklisted', async () => {
    redisService.get.mockImplementation((key: string) =>
      Promise.resolve(key === 'auth:blocked:user-1' ? '1' : null),
    );

    await expect(strategy.validate(payload)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('fails open (allows the request through) when Redis itself is unavailable', async () => {
    redisService.get.mockRejectedValue(new Error('Redis connection refused'));

    const result = await strategy.validate(payload);

    expect(result.userId).toBe('user-1');
  });

  it('does not query the blacklist key when the token has no jti (defensive — every token issued today does)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { jti, ...payloadWithoutJti } = payload;

    await strategy.validate(payloadWithoutJti);

    expect(redisService.get).not.toHaveBeenCalledWith(
      expect.stringContaining('auth:blacklist:'),
    );
  });
});
