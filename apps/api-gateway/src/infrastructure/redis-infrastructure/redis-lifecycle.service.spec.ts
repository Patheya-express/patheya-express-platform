import { RedisLifecycleService } from './redis-lifecycle.service';

function buildService(
  registryOverrides: Partial<Record<string, jest.Mock>> = {},
) {
  const registry = {
    getClient: jest.fn(),
    getAll: jest.fn().mockReturnValue([]),
    ...registryOverrides,
  };
  const metrics = {
    recordError: jest.fn(),
    recordDisconnect: jest.fn(),
    recordReconnect: jest.fn(),
  };

  const service = new RedisLifecycleService(registry as any, metrics as any);

  return { service, registry };
}

describe('RedisLifecycleService.close', () => {
  it('quits the registered client for the given name', async () => {
    const quit = jest.fn().mockResolvedValue('OK');
    const { service, registry } = buildService({
      getClient: jest.fn().mockReturnValue({ quit }),
    });

    await service.close('socketio:publisher');

    expect(registry.getClient).toHaveBeenCalledWith('socketio:publisher');
    expect(quit).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when no client is registered under that name (e.g. shutdown before afterInit ran)', async () => {
    const { service } = buildService({
      getClient: jest.fn().mockReturnValue(undefined),
    });

    await expect(service.close('socketio:publisher')).resolves.toBeUndefined();
  });

  it('does not throw if the client is already closed and .quit() rejects', async () => {
    const quit = jest.fn().mockRejectedValue(new Error('Connection is closed'));
    const { service } = buildService({
      getClient: jest.fn().mockReturnValue({ quit }),
    });

    await expect(service.close('socketio:publisher')).resolves.toBeUndefined();
  });

  it('is idempotent — closing the same name twice succeeds both times', async () => {
    const quit = jest.fn().mockResolvedValue('OK');
    const { service } = buildService({
      getClient: jest.fn().mockReturnValue({ quit }),
    });

    await service.close('socketio:publisher');
    await service.close('socketio:publisher');

    expect(quit).toHaveBeenCalledTimes(2);
  });
});

describe('RedisLifecycleService.shutdownAll', () => {
  it('closes every registered connection', async () => {
    const quitPublisher = jest.fn().mockResolvedValue('OK');
    const quitSubscriber = jest.fn().mockResolvedValue('OK');

    const clients: Record<string, { quit: jest.Mock }> = {
      'socketio:publisher': { quit: quitPublisher },
      'socketio:subscriber': { quit: quitSubscriber },
    };

    const { service } = buildService({
      getAll: jest
        .fn()
        .mockReturnValue([
          { name: 'socketio:publisher' },
          { name: 'socketio:subscriber' },
        ]),
      getClient: jest.fn((name: string) => clients[name]),
    });

    await service.shutdownAll();

    expect(quitPublisher).toHaveBeenCalledTimes(1);
    expect(quitSubscriber).toHaveBeenCalledTimes(1);
  });

  it('does not fail the whole sweep if one connection errors while closing', async () => {
    const quitOk = jest.fn().mockResolvedValue('OK');
    const quitFails = jest.fn().mockRejectedValue(new Error('boom'));

    const clients: Record<string, { quit: jest.Mock }> = {
      'redis:general': { quit: quitOk },
      'socketio:publisher': { quit: quitFails },
    };

    const { service } = buildService({
      getAll: jest
        .fn()
        .mockReturnValue([
          { name: 'redis:general' },
          { name: 'socketio:publisher' },
        ]),
      getClient: jest.fn((name: string) => clients[name]),
    });

    await expect(service.shutdownAll()).resolves.toBeUndefined();
    expect(quitOk).toHaveBeenCalledTimes(1);
    expect(quitFails).toHaveBeenCalledTimes(1);
  });
});
