import { createVerify, generateKeyPairSync } from 'crypto';

import { FcmPushProvider, fcmCredentialsFromEnv } from './fcm-push-provider';

/**
 * FCM HTTP v1 provider — exercised against a fake `fetch` (no network). The service-account JWT is
 * signed with a throwaway RSA key generated here and verified with its public half, so the auth
 * exchange is genuinely checked, not merely mocked.
 */
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const CREDENTIALS = {
  projectId: 'patheya-test',
  clientEmail: 'push@patheya-test.iam.gserviceaccount.com',
  privateKey,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const MESSAGE = {
  title: 'New delivery assigned',
  body: 'You have a new delivery offer.',
  data: { type: 'delivery.assignment', assignmentId: 'assignment-1' },
};

describe('FcmPushProvider', () => {
  let fetchFn: jest.Mock;
  let sendResponses: Record<string, Response>;

  beforeEach(() => {
    sendResponses = {};
    fetchFn = jest.fn((url: string, init: RequestInit) => {
      if (url === 'https://oauth2.googleapis.com/token') {
        return Promise.resolve(
          jsonResponse(200, { access_token: 'access-1', expires_in: 3600 }),
        );
      }
      const { message } = JSON.parse(init.body as string) as {
        message: { token: string };
      };
      return Promise.resolve(
        sendResponses[message.token] ?? jsonResponse(200, { name: 'msg' }),
      );
    });
  });

  function tokenCalls(): jest.Mock['mock']['calls'] {
    return fetchFn.mock.calls.filter(
      ([url]) => url === 'https://oauth2.googleapis.com/token',
    );
  }

  it('authenticates with a valid RS256 service-account assertion for the messaging scope', async () => {
    const provider = new FcmPushProvider(CREDENTIALS, fetchFn as typeof fetch);

    await provider.send(['token-a'], MESSAGE);

    const [, init] = tokenCalls()[0] as [string, RequestInit];
    const assertion =
      new URLSearchParams(init.body as string).get('assertion') ?? '';
    const [header, claims, signature] = assertion.split('.');
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${header}.${claims}`);

    expect(
      verifier.verify(publicKey, Buffer.from(signature, 'base64url')),
    ).toBe(true);
    expect(
      JSON.parse(Buffer.from(claims, 'base64url').toString()) as Record<
        string,
        unknown
      >,
    ).toMatchObject({
      iss: CREDENTIALS.clientEmail,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
    });
  });

  it('sends one high-priority v1 message per token with the bearer token and string data', async () => {
    const provider = new FcmPushProvider(CREDENTIALS, fetchFn as typeof fetch);

    const results = await provider.send(['token-a', 'token-b'], MESSAGE);

    expect(results).toEqual([
      { token: 'token-a', outcome: 'accepted' },
      { token: 'token-b', outcome: 'accepted' },
    ]);
    const sendCall = fetchFn.mock.calls.find(([url]) =>
      String(url).includes('/messages:send'),
    ) as [string, RequestInit];
    expect(sendCall[0]).toBe(
      'https://fcm.googleapis.com/v1/projects/patheya-test/messages:send',
    );
    expect((sendCall[1].headers as Record<string, string>).Authorization).toBe(
      'Bearer access-1',
    );
    expect(JSON.parse(sendCall[1].body as string)).toMatchObject({
      message: {
        notification: { title: MESSAGE.title, body: MESSAGE.body },
        data: MESSAGE.data,
        android: { priority: 'HIGH' },
      },
    });
  });

  it('caches the access token until shortly before it expires', async () => {
    let now = 1_000_000;
    const provider = new FcmPushProvider(
      CREDENTIALS,
      fetchFn as typeof fetch,
      () => now,
    );

    await provider.send(['token-a'], MESSAGE);
    now += 30 * 60_000;
    await provider.send(['token-a'], MESSAGE);
    expect(tokenCalls()).toHaveLength(1);

    now += 29.5 * 60_000; // inside the 60 s refresh margin
    await provider.send(['token-a'], MESSAGE);
    expect(tokenCalls()).toHaveLength(2);
  });

  it('maps UNREGISTERED / INVALID_ARGUMENT / 404 to invalid-token and other errors to failed', async () => {
    sendResponses = {
      unregistered: jsonResponse(404, {
        error: {
          status: 'NOT_FOUND',
          details: [{ errorCode: 'UNREGISTERED' }],
        },
      }),
      malformed: jsonResponse(400, {
        error: { status: 'INVALID_ARGUMENT' },
      }),
      busy: jsonResponse(503, { error: { status: 'UNAVAILABLE' } }),
    };
    const provider = new FcmPushProvider(CREDENTIALS, fetchFn as typeof fetch);

    const results = await provider.send(
      ['unregistered', 'malformed', 'busy'],
      MESSAGE,
    );

    expect(results).toEqual([
      {
        token: 'unregistered',
        outcome: 'invalid-token',
        error: 'UNREGISTERED',
      },
      {
        token: 'malformed',
        outcome: 'invalid-token',
        error: 'INVALID_ARGUMENT',
      },
      { token: 'busy', outcome: 'failed', error: 'UNAVAILABLE' },
    ]);
  });

  it('throws (so the job retries) when authentication itself fails', async () => {
    fetchFn.mockImplementationOnce(() =>
      Promise.resolve(jsonResponse(401, { error: 'invalid_grant' })),
    );
    const provider = new FcmPushProvider(CREDENTIALS, fetchFn as typeof fetch);

    await expect(provider.send(['token-a'], MESSAGE)).rejects.toThrow(
      /FCM authentication failed \(HTTP 401\)/,
    );
  });
});

describe('fcmCredentialsFromEnv', () => {
  it('is null unless all three variables are set', () => {
    expect(
      fcmCredentialsFromEnv({
        FCM_PROJECT_ID: 'p',
        FCM_CLIENT_EMAIL: 'e@example.com',
      }),
    ).toBeNull();
  });

  it('restores newlines in an escaped private key', () => {
    const credentials = fcmCredentialsFromEnv({
      FCM_PROJECT_ID: 'p',
      FCM_CLIENT_EMAIL: 'e@example.com',
      FCM_PRIVATE_KEY:
        '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----',
    });

    expect(credentials?.privateKey).toBe(
      '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
    );
  });
});
