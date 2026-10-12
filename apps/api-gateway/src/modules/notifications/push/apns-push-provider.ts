import { sign } from 'crypto';
import { connect, constants } from 'http2';

import type {
  PushMessage,
  PushProvider,
  PushSendResult,
} from './push-provider';

/** Token-based (.p8) APNs credentials from Apple Developer → Keys. */
export interface ApnsCredentials {
  keyId: string;
  teamId: string;
  /** The iOS app's bundle identifier, sent as `apns-topic`. */
  bundleId: string;
  /** PEM contents of the .p8 key. Environment variables usually carry it with literal `\n`. */
  privateKey: string;
  /** `production` for TestFlight/App Store builds, `development` for Xcode debug builds. */
  environment: 'production' | 'development';
}

/** One APNs HTTP/2 request/response — injectable so the provider is testable without network. */
export type ApnsRequester = (request: {
  host: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}) => Promise<{ status: number; body: string }>;

const HOSTS: Record<ApnsCredentials['environment'], string> = {
  production: 'https://api.push.apple.com',
  development: 'https://api.sandbox.push.apple.com',
};

/** Apple rejects provider tokens older than an hour and throttles refreshing more often than
 *  every 20 minutes; 50 minutes sits safely between the two. */
const PROVIDER_TOKEN_TTL_MS = 50 * 60_000;

/** Reasons meaning the device token itself will never work again. */
const PERMANENT_TOKEN_REASONS = new Set([
  'BadDeviceToken',
  'DeviceTokenNotForTopic',
  'Unregistered',
]);

function base64Url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/** Reads APNS_KEY_ID / APNS_TEAM_ID / APNS_BUNDLE_ID / APNS_PRIVATE_KEY (+ optional
 *  APNS_ENVIRONMENT, default production); null unless the four required ones are set. */
export function apnsCredentialsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ApnsCredentials | null {
  const keyId = env['APNS_KEY_ID']?.trim();
  const teamId = env['APNS_TEAM_ID']?.trim();
  const bundleId = env['APNS_BUNDLE_ID']?.trim();
  const privateKey = env['APNS_PRIVATE_KEY']?.replace(/\\n/g, '\n').trim();

  if (!keyId || !teamId || !bundleId || !privateKey) {
    return null;
  }

  return {
    keyId,
    teamId,
    bundleId,
    privateKey,
    environment:
      env['APNS_ENVIRONMENT']?.trim() === 'development'
        ? 'development'
        : 'production',
  };
}

/** Default transport: one short-lived HTTP/2 session per request (a partner has few devices). */
export const http2ApnsRequester: ApnsRequester = ({
  host,
  path,
  headers,
  body,
}) =>
  new Promise((resolve, reject) => {
    const session = connect(host);
    session.on('error', (error: Error) => reject(error));

    const request = session.request({
      [constants.HTTP2_HEADER_METHOD]: 'POST',
      [constants.HTTP2_HEADER_PATH]: path,
      ...headers,
    });

    let status = 0;
    let responseBody = '';
    request.setEncoding('utf8');
    request.on('response', (responseHeaders) => {
      status = Number(responseHeaders[constants.HTTP2_HEADER_STATUS]);
    });
    request.on('data', (chunk: string) => {
      responseBody += chunk;
    });
    request.on('end', () => {
      session.close();
      resolve({ status, body: responseBody });
    });
    request.on('error', (error: Error) => {
      session.close();
      reject(error);
    });

    request.end(body);
  });

/**
 * Apple Push Notification service provider for iOS devices (the app registers raw APNs device
 * tokens — see PlatformPushDispatcher). Token-based auth: an ES256 JWT signed with the .p8 key,
 * cached for 50 minutes. Uses only Node built-ins (`crypto`, `http2`). Never logs tokens or keys.
 */
export class ApnsPushProvider implements PushProvider {
  readonly name = 'apns';

  private providerToken: { value: string; issuedAt: number } | null = null;

  constructor(
    private readonly credentials: ApnsCredentials,
    private readonly requester: ApnsRequester = http2ApnsRequester,
    private readonly now: () => number = Date.now,
  ) {}

  isConfigured(): boolean {
    return true;
  }

  async send(
    tokens: string[],
    message: PushMessage,
  ): Promise<PushSendResult[]> {
    const authorization = `bearer ${this.getProviderToken()}`;
    const body = JSON.stringify({
      aps: {
        alert: { title: message.title, body: message.body },
        sound: 'default',
      },
      ...message.data,
    });

    return Promise.all(
      tokens.map((token) => this.sendOne(token, authorization, body)),
    );
  }

  private async sendOne(
    token: string,
    authorization: string,
    body: string,
  ): Promise<PushSendResult> {
    try {
      const response = await this.requester({
        host: HOSTS[this.credentials.environment],
        path: `/3/device/${encodeURIComponent(token)}`,
        headers: {
          authorization,
          'apns-topic': this.credentials.bundleId,
          'apns-push-type': 'alert',
          // Time-sensitive offers: deliver immediately.
          'apns-priority': '10',
          'content-type': 'application/json',
        },
        body,
      });

      if (response.status === 200) {
        return { token, outcome: 'accepted' };
      }

      const reason = this.reason(response.body);

      if (
        response.status === 410 ||
        (reason !== null && PERMANENT_TOKEN_REASONS.has(reason))
      ) {
        return {
          token,
          outcome: 'invalid-token',
          error: reason ?? 'Unregistered',
        };
      }

      if (
        reason === 'ExpiredProviderToken' ||
        reason === 'InvalidProviderToken'
      ) {
        // Force a fresh JWT on the retry.
        this.providerToken = null;
      }

      return {
        token,
        outcome: 'failed',
        error: reason ?? `HTTP ${response.status}`,
      };
    } catch (error) {
      return {
        token,
        outcome: 'failed',
        error: error instanceof Error ? error.message : 'APNs request failed',
      };
    }
  }

  private reason(body: string): string | null {
    try {
      return (JSON.parse(body) as { reason?: string }).reason ?? null;
    } catch {
      return null;
    }
  }

  private getProviderToken(): string {
    if (
      this.providerToken &&
      this.now() - this.providerToken.issuedAt < PROVIDER_TOKEN_TTL_MS
    ) {
      return this.providerToken.value;
    }

    const issuedAt = this.now();
    const header = base64Url(
      JSON.stringify({ alg: 'ES256', kid: this.credentials.keyId }),
    );
    const claims = base64Url(
      JSON.stringify({
        iss: this.credentials.teamId,
        iat: Math.floor(issuedAt / 1000),
      }),
    );
    // JWS ES256 needs the raw r||s signature, not DER.
    const signature = sign('sha256', Buffer.from(`${header}.${claims}`), {
      key: this.credentials.privateKey,
      dsaEncoding: 'ieee-p1363',
    });

    const value = `${header}.${claims}.${base64Url(signature)}`;
    this.providerToken = { value, issuedAt };
    return value;
  }
}
