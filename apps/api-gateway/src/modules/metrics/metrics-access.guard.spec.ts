import { ExecutionContext, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { MetricsAccessGuard } from './metrics-access.guard';

const TOKEN = 'm'.repeat(40);

function guardFor(nodeEnv: string, authToken?: string) {
  return new MetricsAccessGuard(
    new ConfigService({ app: { nodeEnv }, metrics: { authToken } }),
  );
}

function ctx(remoteAddress: string, authorization?: string): ExecutionContext {
  const req = {
    socket: { remoteAddress },
    headers: authorization ? { authorization } : {},
    // Spoofing attempt: must be ignored — only the TCP peer counts.
    ip: '127.0.0.1',
  };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('MetricsAccessGuard', () => {
  it('leaves /metrics open outside production', () => {
    expect(guardFor('development').canActivate(ctx('10.0.1.5'))).toBe(true);
    expect(guardFor('staging').canActivate(ctx('203.0.113.9'))).toBe(true);
  });

  describe('production', () => {
    it('returns 404 to remote callers (via the ALB) even when req.ip claims loopback', () => {
      expect(() => guardFor('production').canActivate(ctx('10.0.1.5'))).toThrow(
        NotFoundException,
      );
    });

    it.each(['127.0.0.1', '::1', '::ffff:127.0.0.1'])(
      'allows the in-task loopback peer %s (ECS Exec)',
      (peer) => {
        expect(guardFor('production').canActivate(ctx(peer))).toBe(true);
      },
    );

    it('allows a remote caller presenting the configured bearer token', () => {
      expect(
        guardFor('production', TOKEN).canActivate(
          ctx('10.0.1.5', `Bearer ${TOKEN}`),
        ),
      ).toBe(true);
    });

    it.each([
      ['wrong token', `Bearer ${'x'.repeat(40)}`],
      ['truncated token', `Bearer ${TOKEN.slice(1)}`],
      ['missing scheme', TOKEN],
      ['no header', undefined],
    ])('rejects %s', (_label, header) => {
      expect(() =>
        guardFor('production', TOKEN).canActivate(ctx('10.0.1.5', header)),
      ).toThrow(NotFoundException);
    });

    it('never accepts an empty bearer when no token is configured', () => {
      expect(() =>
        guardFor('production').canActivate(ctx('10.0.1.5', 'Bearer ')),
      ).toThrow(NotFoundException);
    });
  });
});
