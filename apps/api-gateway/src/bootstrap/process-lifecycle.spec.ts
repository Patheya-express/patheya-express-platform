import {
  isRedisShuttingDown,
  resetRedisShuttingDownForTests,
} from '../infrastructure/redis/redis-retry-policy';

import { registerProcessLifecycleHandlers } from './process-lifecycle';

type Listener = (...args: unknown[]) => void;

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('registerProcessLifecycleHandlers', () => {
  let listeners: Record<string, Listener>;
  let onSpy: jest.SpyInstance;
  let exitSpy: jest.SpyInstance;

  beforeEach(() => {
    listeners = {};

    onSpy = jest
      .spyOn(process, 'on')
      .mockImplementation((event: string, handler: Listener) => {
        listeners[event] = handler;
        return process;
      });

    exitSpy = jest
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as unknown as typeof process.exit);
  });

  afterEach(() => {
    onSpy.mockRestore();
    exitSpy.mockRestore();
    resetRedisShuttingDownForTests();
    jest.useRealTimers();
  });

  function setup(shutdownTimeoutMs = 5000) {
    const app = { close: jest.fn().mockResolvedValue(undefined) };
    const logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn() };

    registerProcessLifecycleHandlers({
      app: app as never,
      logger: logger as never,
      context: 'TestBootstrap',
      shutdownTimeoutMs,
    });

    return { app, logger };
  }

  it('registers handlers for SIGTERM, SIGINT, unhandledRejection, and uncaughtException', () => {
    setup();

    expect(typeof listeners['SIGTERM']).toBe('function');
    expect(typeof listeners['SIGINT']).toBe('function');
    expect(typeof listeners['unhandledRejection']).toBe('function');
    expect(typeof listeners['uncaughtException']).toBe('function');
  });

  it('logs, marks Redis as shutting down, and closes the app on unhandledRejection', async () => {
    const { app, logger } = setup();
    const error = new Error('boom');

    listeners['unhandledRejection'](error);
    await flushMicrotasks();

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'unhandled_rejection',
        message: 'boom',
      }),
      error.stack,
      'TestBootstrap',
    );
    expect(isRedisShuttingDown()).toBe(true);
    expect(app.close).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('logs, marks Redis as shutting down, and closes the app on uncaughtException', async () => {
    const { app, logger } = setup();
    const error = new Error('fatal');

    listeners['uncaughtException'](error);
    await flushMicrotasks();

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'uncaught_exception',
        message: 'fatal',
      }),
      error.stack,
      'TestBootstrap',
    );
    expect(isRedisShuttingDown()).toBe(true);
    expect(app.close).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('does not attempt a second shutdown if unhandledRejection fires again mid-shutdown', async () => {
    const { app, logger } = setup();

    listeners['unhandledRejection'](new Error('first'));
    listeners['unhandledRejection'](new Error('second'));
    await flushMicrotasks();

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(app.close).toHaveBeenCalledTimes(1);
  });

  it('does not attempt a second shutdown if uncaughtException fires after unhandledRejection already started one', async () => {
    const { app, logger } = setup();

    listeners['unhandledRejection'](new Error('first'));
    listeners['uncaughtException'](new Error('second'));
    await flushMicrotasks();

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(app.close).toHaveBeenCalledTimes(1);
  });

  it('still force-exits via the fallback timer if app.close() hangs on a fatal error', () => {
    jest.useFakeTimers();

    const app = { close: jest.fn(() => new Promise(() => {})) }; // never resolves
    const logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn() };

    registerProcessLifecycleHandlers({
      app: app as never,
      logger: logger as never,
      context: 'TestBootstrap',
      shutdownTimeoutMs: 5000,
    });

    listeners['unhandledRejection'](new Error('hangs'));

    expect(exitSpy).not.toHaveBeenCalled();

    jest.advanceTimersByTime(5000);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'unhandled_rejection_shutdown_timeout',
      }),
      undefined,
      'TestBootstrap',
    );
  });

  describe('SIGTERM/SIGINT (unchanged behavior)', () => {
    it('logs the signal, marks Redis as shutting down, and does not itself call app.close()', () => {
      const { app, logger } = setup();

      listeners['SIGTERM']();

      expect(logger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'shutdown_signal_received',
          signal: 'SIGTERM',
        }),
        'TestBootstrap',
      );
      expect(isRedisShuttingDown()).toBe(true);
      // Nest's own enableShutdownHooks() listener (not this code) performs the actual close() for
      // a real OS signal — this handler only logs and arms the fallback timer.
      expect(app.close).not.toHaveBeenCalled();
    });

    it('force-exits via the fallback timer if shutdown hangs after a signal', () => {
      jest.useFakeTimers();
      setup(5000);

      listeners['SIGTERM']();

      expect(exitSpy).not.toHaveBeenCalled();

      jest.advanceTimersByTime(5000);

      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('does not double-trigger if both SIGTERM and SIGINT arrive', () => {
      const { logger } = setup();

      listeners['SIGTERM']();
      listeners['SIGINT']();

      expect(logger.log).toHaveBeenCalledTimes(1);
    });

    it('a signal after a fatal-error shutdown has already started does not re-trigger', async () => {
      const { app, logger } = setup();

      listeners['unhandledRejection'](new Error('first'));
      await flushMicrotasks();

      listeners['SIGTERM']();

      expect(logger.log).not.toHaveBeenCalled();
      expect(app.close).toHaveBeenCalledTimes(1);
    });
  });
});
