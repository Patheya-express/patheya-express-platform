import { Agent, createServer, request, Server } from 'http';
import { AddressInfo } from 'net';
import {
  applyHttpServerTimeouts,
  DEFAULT_LB_IDLE_TIMEOUT_SECONDS,
  KEEP_ALIVE_MARGIN_MS,
  resolveHttpServerTimeouts,
} from './http-server-timeouts';

describe('resolveHttpServerTimeouts', () => {
  it('defaults to the production ALB idle timeout plus a margin', () => {
    expect(resolveHttpServerTimeouts({})).toEqual({
      keepAliveTimeoutMs:
        DEFAULT_LB_IDLE_TIMEOUT_SECONDS * 1000 + KEEP_ALIVE_MARGIN_MS,
    });
    expect(resolveHttpServerTimeouts({}).keepAliveTimeoutMs).toBe(305_000);
  });

  it('follows a different load balancer idle timeout', () => {
    expect(
      resolveHttpServerTimeouts({ LB_IDLE_TIMEOUT_SECONDS: '60' }),
    ).toEqual({
      keepAliveTimeoutMs: 65_000,
    });
  });

  it('accepts an explicit keep-alive above the idle timeout', () => {
    expect(
      resolveHttpServerTimeouts({ HTTP_KEEP_ALIVE_TIMEOUT_MS: '310000' })
        .keepAliveTimeoutMs,
    ).toBe(310_000);
  });

  it.each(['300000', '5000'])(
    'rejects an explicit keep-alive at or below the idle timeout (%s)',
    (value) => {
      expect(() =>
        resolveHttpServerTimeouts({ HTTP_KEEP_ALIVE_TIMEOUT_MS: value }),
      ).toThrow(/must exceed the load balancer idle timeout/);
    },
  );

  it.each(['abc', '0', '-1', '1.5'])(
    'rejects a malformed value (%s)',
    (value) => {
      expect(() =>
        resolveHttpServerTimeouts({ LB_IDLE_TIMEOUT_SECONDS: value }),
      ).toThrow(/positive integer/);
      expect(() =>
        resolveHttpServerTimeouts({ HTTP_KEEP_ALIVE_TIMEOUT_MS: value }),
      ).toThrow(/positive integer/);
    },
  );

  it('treats empty values as unset', () => {
    expect(
      resolveHttpServerTimeouts({
        LB_IDLE_TIMEOUT_SECONDS: '',
        HTTP_KEEP_ALIVE_TIMEOUT_MS: ' ',
      }).keepAliveTimeoutMs,
    ).toBe(305_000);
  });
});

describe('applyHttpServerTimeouts (real HTTP server)', () => {
  let server: Server;

  afterEach(async () => {
    if (server?.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  function listen(): Promise<number> {
    return new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () =>
        resolve((server.address() as AddressInfo).port),
      );
    });
  }

  function get(port: number, agent: Agent): Promise<number | undefined> {
    return new Promise((resolve, reject) => {
      const req = request(
        { port, host: '127.0.0.1', path: '/', agent },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode));
        },
      );
      req.on('error', reject);
      req.end();
    });
  }

  it('sets keepAliveTimeout on the server', () => {
    server = createServer();
    applyHttpServerTimeouts(server, { keepAliveTimeoutMs: 305_000 });
    expect(server.keepAliveTimeout).toBe(305_000);
  });

  async function connectionsAcrossIdleGap(
    keepAliveTimeoutMs: number,
    gapMs: number,
  ) {
    server = createServer((_req, res) => res.end('ok'));
    applyHttpServerTimeouts(server, { keepAliveTimeoutMs });
    const port = await listen();
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    let connections = 0;
    server.on('connection', () => connections++);
    expect(await get(port, agent)).toBe(200);
    await new Promise((r) => setTimeout(r, gapMs));
    expect(await get(port, agent)).toBe(200);
    agent.destroy();
    return connections;
  }

  it('closes the idle socket when keep-alive is shorter than the idle gap (the 502 window)', async () => {
    // The server-side close is what the ALB can race with; a Node client simply reconnects.
    expect(await connectionsAcrossIdleGap(100, 400)).toBe(2);
  });

  it('keeps an idle keep-alive socket open past the Node default, and still shuts down', async () => {
    server = createServer((_req, res) => res.end('ok'));
    // Scaled down: 3 s keep-alive vs a 500 ms idle gap, same relationship as 305 s vs the ALB's
    // reuse of idle connections. (Node's client Agent drops a socket ~1 s before the server's
    // advertised Keep-Alive timeout, so the server timeout must comfortably exceed that buffer.)
    applyHttpServerTimeouts(server, { keepAliveTimeoutMs: 3_000 });
    const port = await listen();
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    const sockets = new Set<unknown>();
    server.on('connection', (s) => sockets.add(s));

    expect(await get(port, agent)).toBe(200);
    await new Promise((r) => setTimeout(r, 500));
    expect(await get(port, agent)).toBe(200);
    // Same TCP connection reused after an idle gap: no close/reconnect race.
    expect(sockets.size).toBe(1);

    agent.destroy();
    // server.close() also closes idle keep-alive sockets on Node >= 19, so shutdown is not held
    // open for the full keep-alive timeout.
    const closedIn = Date.now();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(Date.now() - closedIn).toBeLessThan(2_000);
  });
});
