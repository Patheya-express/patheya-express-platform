import { RealtimeGateway } from './realtime.gateway';

import { RedisConnectionName } from '../../../infrastructure/redis-infrastructure/enums/redis-connection-name.enum';

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
