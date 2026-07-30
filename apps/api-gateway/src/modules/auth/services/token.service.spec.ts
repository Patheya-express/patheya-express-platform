import { JwtService } from '@nestjs/jwt';

import { TokenService } from './token.service';

describe('TokenService', () => {
  let jwtService: JwtService;
  let service: TokenService;

  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET = 'access-secret';
    process.env.JWT_REFRESH_SECRET = 'refresh-secret';
    jwtService = new JwtService();
    service = new TokenService(jwtService);
  });

  it('stamps every access token with a unique jti', async () => {
    const tokenA = await service.generateAccessToken({ sub: 'user-1' });
    const tokenB = await service.generateAccessToken({ sub: 'user-1' });

    const payloadA = jwtService.decode<{ jti: string }>(tokenA);
    const payloadB = jwtService.decode<{ jti: string }>(tokenB);

    expect(typeof payloadA.jti).toBe('string');
    expect(payloadA.jti).not.toBe(payloadB.jti);
  });

  it('verifyAccessToken round-trips the jti and exp claims logout needs to blacklist a token', async () => {
    const token = await service.generateAccessToken({ sub: 'user-1' });

    const payload = await service.verifyAccessToken(token);

    expect(payload.sub).toBe('user-1');
    expect(typeof payload.jti).toBe('string');
    expect(typeof payload.exp).toBe('number');
  });

  it('verifyAccessToken rejects a token signed with the wrong secret', async () => {
    const rogueJwtService = new JwtService();
    const rogueToken = await rogueJwtService.signAsync(
      { sub: 'user-1' },
      { secret: 'not-the-real-secret' },
    );

    await expect(service.verifyAccessToken(rogueToken)).rejects.toThrow();
  });
});
