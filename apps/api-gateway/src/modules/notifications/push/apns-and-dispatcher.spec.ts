import { generateKeyPairSync, verify } from 'crypto';
import { createServer } from 'http2';

import {
  ApnsPushProvider,
  apnsCredentialsFromEnv,
  http2ApnsRequester,
  type ApnsRequester,
} from './apns-push-provider';
import { PlatformPushDispatcher } from './platform-push-dispatcher';
import { UnconfiguredPushProvider, type PushProvider } from './push-provider';

const MESSAGE = {
  title: 'New delivery assigned',
  body: 'You have a new delivery offer.',
  data: { type: 'delivery.assignment', assignmentId: 'assignment-1' },
};

describe('PlatformPushDispatcher', () => {
  function provider(name: string): PushProvider & { send: jest.Mock } {
    return {
      name,
      isConfigured: () => true,
      send: jest.fn((tokens: string[]) =>
        Promise.resolve(
          tokens.map((token) => ({ token, outcome: 'accepted' as const })),
        ),
      ),
    };
  }

  it('sends Android devices to the Android provider and iOS devices to the iOS provider', async () => {
    const android = provider('fcm');
    const ios = provider('apns');
    const dispatcher = new PlatformPushDispatcher({ android, ios });

    const results = await dispatcher.send(
      [
        { token: 'a1', platform: 'android' },
        { token: 'i1', platform: 'ios' },
        { token: 'a2', platform: 'android' },
      ],
      MESSAGE,
    );

    expect(android.send).toHaveBeenCalledWith(['a1', 'a2'], MESSAGE);
    expect(ios.send).toHaveBeenCalledWith(['i1'], MESSAGE);
    expect(results.map((r) => r.outcome)).toEqual([
      'accepted',
      'accepted',
      'accepted',
    ]);
  });

  it('skips (never attempts) devices whose platform has no configured provider', async () => {
    const android = provider('fcm');
    const dispatcher = new PlatformPushDispatcher({
      android,
      ios: new UnconfiguredPushProvider(),
    });

    const results = await dispatcher.send(
      [
        { token: 'i1', platform: 'ios' },
        { token: 'w1', platform: 'web' },
      ],
      MESSAGE,
    );

    expect(android.send).not.toHaveBeenCalled();
    expect(results.map((r) => r.outcome)).toEqual(['skipped', 'skipped']);
  });

  it('is configured only when at least one platform is', () => {
    expect(
      new PlatformPushDispatcher({
        android: new UnconfiguredPushProvider(),
        ios: new UnconfiguredPushProvider(),
      }).isConfigured(),
    ).toBe(false);
    expect(
      new PlatformPushDispatcher({
        android: provider('fcm'),
        ios: new UnconfiguredPushProvider(),
      }).isConfigured(),
    ).toBe(true);
  });
});

describe('ApnsPushProvider', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });

  const CREDENTIALS = {
    keyId: 'KEY123',
    teamId: 'TEAM456',
    bundleId: 'com.patheyaexpress.delivery',
    privateKey,
    environment: 'production' as const,
  };

  let requester: jest.Mock<
    ReturnType<ApnsRequester>,
    Parameters<ApnsRequester>
  >;
  let responses: Record<string, { status: number; body: string }>;

  beforeEach(() => {
    responses = {};
    requester = jest.fn((request: Parameters<ApnsRequester>[0]) => {
      const token = decodeURIComponent(request.path.replace('/3/device/', ''));
      return Promise.resolve(responses[token] ?? { status: 200, body: '' });
    });
  });

  it('sends an alert push to the production host with a valid ES256 provider token', async () => {
    const provider = new ApnsPushProvider(CREDENTIALS, requester);

    const results = await provider.send(['device-1'], MESSAGE);

    expect(results).toEqual([{ token: 'device-1', outcome: 'accepted' }]);
    const [request] = requester.mock.calls[0];
    expect(request.host).toBe('https://api.push.apple.com');
    expect(request.headers).toMatchObject({
      'apns-topic': 'com.patheyaexpress.delivery',
      'apns-push-type': 'alert',
      'apns-priority': '10',
    });
    expect(JSON.parse(request.body)).toEqual({
      aps: {
        alert: { title: MESSAGE.title, body: MESSAGE.body },
        sound: 'default',
      },
      type: 'delivery.assignment',
      assignmentId: 'assignment-1',
    });

    const jwt = request.headers['authorization'].replace('bearer ', '');
    const [header, claims, signature] = jwt.split('.');
    expect(
      verify(
        'sha256',
        Buffer.from(`${header}.${claims}`),
        { key: publicKey, dsaEncoding: 'ieee-p1363' },
        Buffer.from(signature, 'base64url'),
      ),
    ).toBe(true);
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({
      alg: 'ES256',
      kid: 'KEY123',
    });
    expect(
      (
        JSON.parse(Buffer.from(claims, 'base64url').toString()) as {
          iss: string;
        }
      ).iss,
    ).toBe('TEAM456');
  });

  it('uses the sandbox host for development builds', async () => {
    const provider = new ApnsPushProvider(
      { ...CREDENTIALS, environment: 'development' },
      requester,
    );

    await provider.send(['device-1'], MESSAGE);

    expect(requester.mock.calls[0][0].host).toBe(
      'https://api.sandbox.push.apple.com',
    );
  });

  it('reuses the provider token within 50 minutes and refreshes after', async () => {
    let now = 1_000_000;
    const provider = new ApnsPushProvider(CREDENTIALS, requester, () => now);

    await provider.send(['device-1'], MESSAGE);
    now += 30_000; // still within the same second-resolution window is fine
    await provider.send(['device-1'], MESSAGE);
    const first = requester.mock.calls[0][0].headers['authorization'];
    expect(requester.mock.calls[1][0].headers['authorization']).toBe(first);

    now += 51 * 60_000;
    await provider.send(['device-1'], MESSAGE);
    expect(requester.mock.calls[2][0].headers['authorization']).not.toBe(first);
  });

  it('maps 410 / BadDeviceToken to invalid-token and other errors to failed', async () => {
    responses = {
      gone: { status: 410, body: JSON.stringify({ reason: 'Unregistered' }) },
      bad: { status: 400, body: JSON.stringify({ reason: 'BadDeviceToken' }) },
      busy: {
        status: 503,
        body: JSON.stringify({ reason: 'ServiceUnavailable' }),
      },
    };
    const provider = new ApnsPushProvider(CREDENTIALS, requester);

    const results = await provider.send(['gone', 'bad', 'busy'], MESSAGE);

    expect(results).toEqual([
      { token: 'gone', outcome: 'invalid-token', error: 'Unregistered' },
      { token: 'bad', outcome: 'invalid-token', error: 'BadDeviceToken' },
      { token: 'busy', outcome: 'failed', error: 'ServiceUnavailable' },
    ]);
  });

  it('reports a transport error as failed (retryable), not as accepted', async () => {
    requester.mockRejectedValueOnce(new Error('ECONNRESET'));
    const provider = new ApnsPushProvider(CREDENTIALS, requester);

    expect(await provider.send(['device-1'], MESSAGE)).toEqual([
      { token: 'device-1', outcome: 'failed', error: 'ECONNRESET' },
    ]);
  });
});

describe('apnsCredentialsFromEnv', () => {
  it('is null unless key id, team id, bundle id and key are all set', () => {
    expect(
      apnsCredentialsFromEnv({
        APNS_KEY_ID: 'k',
        APNS_TEAM_ID: 't',
        APNS_BUNDLE_ID: 'b',
      }),
    ).toBeNull();
  });

  it('defaults to production and restores escaped newlines in the key', () => {
    expect(
      apnsCredentialsFromEnv({
        APNS_KEY_ID: 'k',
        APNS_TEAM_ID: 't',
        APNS_BUNDLE_ID: 'b',
        APNS_PRIVATE_KEY: 'line1\\nline2',
      }),
    ).toEqual({
      keyId: 'k',
      teamId: 't',
      bundleId: 'b',
      privateKey: 'line1\nline2',
      environment: 'production',
    });
  });
});

describe('http2ApnsRequester (real HTTP/2 transport against a local server)', () => {
  it('POSTs the path, headers and body and returns the status and response body', async () => {
    const received: { headers: Record<string, unknown>; body: string }[] = [];
    const server = createServer((request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => (body += chunk));
      request.on('end', () => {
        received.push({ headers: { ...request.headers }, body });
        response.writeHead(410, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ reason: 'Unregistered' }));
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const { port } = server.address() as { port: number };

    try {
      const result = await http2ApnsRequester({
        host: `http://127.0.0.1:${port}`,
        path: '/3/device/abc123',
        headers: { 'apns-topic': 'com.patheyaexpress.delivery' },
        body: '{"aps":{}}',
      });

      expect(result).toEqual({
        status: 410,
        body: JSON.stringify({ reason: 'Unregistered' }),
      });
      expect(received[0].headers[':method']).toBe('POST');
      expect(received[0].headers[':path']).toBe('/3/device/abc123');
      expect(received[0].headers['apns-topic']).toBe(
        'com.patheyaexpress.delivery',
      );
      expect(received[0].body).toBe('{"aps":{}}');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
