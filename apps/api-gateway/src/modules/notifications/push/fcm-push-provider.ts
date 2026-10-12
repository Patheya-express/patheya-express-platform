import { createSign } from 'crypto';

import type {
  PushMessage,
  PushProvider,
  PushSendResult,
} from './push-provider';

/** Service-account fields from a Firebase project's credentials JSON. */
export interface FcmCredentials {
  projectId: string;
  clientEmail: string;
  /** PEM private key. Environment variables usually carry it with literal `\n` sequences. */
  privateKey: string;
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
/** Refresh the OAuth token this long before Google's stated expiry. */
const TOKEN_REFRESH_MARGIN_MS = 60_000;

/** Error codes in an FCM v1 error response that mean "this token will never work again". */
const PERMANENT_TOKEN_ERRORS = new Set(['UNREGISTERED', 'INVALID_ARGUMENT']);

type FetchLike = typeof fetch;

function base64Url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/** Reads FCM_PROJECT_ID / FCM_CLIENT_EMAIL / FCM_PRIVATE_KEY; null unless all three are set. */
export function fcmCredentialsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): FcmCredentials | null {
  const projectId = env['FCM_PROJECT_ID']?.trim();
  const clientEmail = env['FCM_CLIENT_EMAIL']?.trim();
  const privateKey = env['FCM_PRIVATE_KEY']?.replace(/\\n/g, '\n').trim();

  if (!projectId || !clientEmail || !privateKey) {
    return null;
  }

  return { projectId, clientEmail, privateKey };
}

/**
 * Firebase Cloud Messaging (HTTP v1) provider — reaches Android directly and iOS through the
 * Firebase project's APNs key. Uses only Node built-ins: the service-account JWT is signed with
 * `crypto` and exchanged for an OAuth access token (cached until shortly before expiry), so no
 * firebase-admin dependency is needed. One request per device token; each result is mapped to
 * accepted / invalid-token / failed (see PushSendResult). Never logs tokens or credentials.
 */
export class FcmPushProvider implements PushProvider {
  readonly name = 'fcm';

  private accessToken: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly credentials: FcmCredentials,
    private readonly fetchFn: FetchLike = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  isConfigured(): boolean {
    return true;
  }

  async send(
    tokens: string[],
    message: PushMessage,
  ): Promise<PushSendResult[]> {
    const accessToken = await this.getAccessToken();

    return Promise.all(
      tokens.map((token) => this.sendOne(accessToken, token, message)),
    );
  }

  private async sendOne(
    accessToken: string,
    token: string,
    message: PushMessage,
  ): Promise<PushSendResult> {
    try {
      const response = await this.fetchFn(
        `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.credentials.projectId)}/messages:send`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: {
              token,
              notification: { title: message.title, body: message.body },
              data: message.data,
              // Time-sensitive offers: deliver immediately rather than batched/deferred.
              android: {
                priority: 'HIGH',
                ...(message.androidChannelId
                  ? { notification: { channel_id: message.androidChannelId } }
                  : {}),
              },
              apns: {
                headers: { 'apns-priority': '10' },
                payload: { aps: { sound: 'default' } },
              },
            },
          }),
        },
      );

      if (response.ok) {
        return { token, outcome: 'accepted' };
      }

      const code = await this.errorCode(response);

      if (
        response.status === 404 ||
        (code && PERMANENT_TOKEN_ERRORS.has(code))
      ) {
        return { token, outcome: 'invalid-token', error: code ?? 'NOT_FOUND' };
      }

      return {
        token,
        outcome: 'failed',
        error: code ?? `HTTP ${response.status}`,
      };
    } catch (error) {
      return {
        token,
        outcome: 'failed',
        error: error instanceof Error ? error.message : 'FCM request failed',
      };
    }
  }

  /** FCM v1 puts the specific reason in error.details[].errorCode, falling back to error.status. */
  private async errorCode(response: Response): Promise<string | null> {
    try {
      const body = (await response.json()) as {
        error?: {
          status?: string;
          details?: Array<{ errorCode?: string }>;
        };
      };
      return (
        body.error?.details?.find((detail) => detail.errorCode)?.errorCode ??
        body.error?.status ??
        null
      );
    } catch {
      return null;
    }
  }

  private async getAccessToken(): Promise<string> {
    if (
      this.accessToken &&
      this.accessToken.expiresAt - TOKEN_REFRESH_MARGIN_MS > this.now()
    ) {
      return this.accessToken.value;
    }

    const issuedAt = Math.floor(this.now() / 1000);
    const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64Url(
      JSON.stringify({
        iss: this.credentials.clientEmail,
        scope: FCM_SCOPE,
        aud: TOKEN_URL,
        iat: issuedAt,
        exp: issuedAt + 3600,
      }),
    );
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${claims}`);
    const assertion = `${header}.${claims}.${base64Url(signer.sign(this.credentials.privateKey))}`;

    const response = await this.fetchFn(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }).toString(),
    });

    if (!response.ok) {
      // Thrown, not mapped per token: no device could be reached, so the job should retry.
      throw new Error(`FCM authentication failed (HTTP ${response.status})`);
    }

    const body = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };

    this.accessToken = {
      value: body.access_token,
      expiresAt: this.now() + body.expires_in * 1000,
    };

    return body.access_token;
  }
}
