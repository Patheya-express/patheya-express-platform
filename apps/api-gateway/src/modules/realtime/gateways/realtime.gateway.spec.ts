import { RealtimeGateway, buildRealtimeCorsOrigin } from './realtime.gateway';

import { RedisConnectionName } from '../../../infrastructure/redis-infrastructure/enums/redis-connection-name.enum';

describe('buildRealtimeCorsOrigin', () => {
  const ENV_KEYS = [
    'NODE_ENV',
    'CUSTOMER_APP_URL',
    'RESTAURANT_APP_URL',
    'ADMIN_APP_URL',
    'DELIVERY_APP_URL',
    'EXTRA_ALLOWED_ORIGINS',
  ] as const;
  const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    process.env.NODE_ENV = 'production';
    process.env.ADMIN_APP_URL = 'https://admin.patheyaexpress.com';
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  function evaluate(origin: string | undefined): {
    err: Error | null;
    allow?: boolean;
  } {
    let result: { err: Error | null; allow?: boolean } = { err: null };
    buildRealtimeCorsOrigin(origin, (err, allow) => {
      result = { err, allow };
    });
    return result;
  }

  it('allows a configured frontend origin', () => {
    expect(evaluate('https://admin.patheyaexpress.com')).toEqual({
      err: null,
      allow: true,
    });
  });

  it('allows origins listed in EXTRA_ALLOWED_ORIGINS, trimmed, like the REST allowlist', () => {
    process.env.EXTRA_ALLOWED_ORIGINS =
      ' https://localhost , capacitor://localhost ,';

    expect(evaluate('https://localhost')).toEqual({ err: null, allow: true });
    expect(evaluate('capacitor://localhost')).toEqual({
      err: null,
      allow: true,
    });
  });

  it('still rejects localhost in production when it is not explicitly listed', () => {
    const { err, allow } = evaluate('https://localhost');

    expect(allow).toBe(false);
    expect(err?.message).toContain('not allowed by CORS');
  });

  it('allows requests without an Origin header', () => {
    expect(evaluate(undefined)).toEqual({ err: null, allow: true });
  });
});

describe('RealtimeGateway.disconnectUser', () => {
  it("disconnects every socket in the target user's room", () => {
    const disconnectSockets = jest.fn().mockResolvedValue(undefined);
    const server = { in: jest.fn().mockReturnValue({ disconnectSockets }) };

    const gateway = new RealtimeGateway(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    (gateway as unknown as { server: typeof server }).server = server;

    gateway.disconnectUser('user-1');

    expect(server.in).toHaveBeenCalledWith('user:user-1');
    expect(disconnectSockets).toHaveBeenCalledWith(true);
  });
});

describe('RealtimeGateway.onApplicationShutdown', () => {
  it('closes both the Socket.IO publisher and subscriber Redis connections', async () => {
    const close = jest.fn().mockResolvedValue(undefined);
    const redisLifecycle = { close };

    const gateway = new RealtimeGateway(
      {} as any,
      {} as any,
      {} as any,
      redisLifecycle as any,
      {} as any,
    );

    await gateway.onApplicationShutdown();

    expect(close).toHaveBeenCalledWith(RedisConnectionName.SOCKETIO_PUBLISHER);
    expect(close).toHaveBeenCalledWith(RedisConnectionName.SOCKETIO_SUBSCRIBER);
    expect(close).toHaveBeenCalledTimes(2);
  });

  it('is idempotent — calling it more than once does not throw and closes both connections each time', async () => {
    const close = jest.fn().mockResolvedValue(undefined);
    const redisLifecycle = { close };

    const gateway = new RealtimeGateway(
      {} as any,
      {} as any,
      {} as any,
      redisLifecycle as any,
      {} as any,
    );

    await gateway.onApplicationShutdown();
    await gateway.onApplicationShutdown();

    expect(close).toHaveBeenCalledTimes(4);
  });

  it('does not attempt to recreate the connections during shutdown (no createConnection/duplicateConnection call)', async () => {
    const close = jest.fn().mockResolvedValue(undefined);
    const redisLifecycle = { close };
    const redisConnectionFactory = {
      createConnection: jest.fn(),
      duplicateConnection: jest.fn(),
    };

    const gateway = new RealtimeGateway(
      {} as any,
      {} as any,
      redisConnectionFactory as any,
      redisLifecycle as any,
      {} as any,
    );

    await gateway.onApplicationShutdown();

    expect(redisConnectionFactory.createConnection).not.toHaveBeenCalled();
    expect(redisConnectionFactory.duplicateConnection).not.toHaveBeenCalled();
  });
});
