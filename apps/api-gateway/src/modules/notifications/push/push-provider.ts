import { Injectable } from '@nestjs/common';

/**
 * What a push carries. `data` values must be strings (the FCM/APNs data-payload constraint) and
 * must never contain customer details — the app treats a push only as "wake up and look", then
 * re-fetches authoritative state after authentication.
 */
export interface PushMessage {
  title: string;
  body: string;
  data: Record<string, string>;
  /** Android notification channel the app created for this kind of push (e.g. assignment
   *  offers). Ignored on iOS. Unknown channels fall back to the app's default channel. */
  androidChannelId?: string;
}

/**
 * Per-token outcome:
 *  - `accepted`      — the provider accepted the message for delivery. This is NOT proof the
 *                      device displayed it (providers don't report that synchronously).
 *  - `invalid-token` — the token is permanently unusable (uninstalled app, expired/rotated
 *                      token); the caller deletes it.
 *  - `failed`        — a transient/unknown failure; the caller may retry.
 *  - `skipped`       — nothing was attempted because no provider is configured for this token's
 *                      platform; neither retried nor deleted.
 */
export interface PushSendResult {
  token: string;
  outcome: 'accepted' | 'invalid-token' | 'failed' | 'skipped';
  error?: string;
}

/**
 * One vendor channel (FCM for Android, APNs for iOS). Receives only tokens of its own platform.
 */
export interface PushProvider {
  readonly name: string;
  /** False when credentials/configuration are absent — nothing is attempted. */
  isConfigured(): boolean;
  send(tokens: string[], message: PushMessage): Promise<PushSendResult[]>;
}

/** A registered device: its token and the platform it registered from (PushToken row). */
export interface PushTarget {
  token: string;
  platform: string;
}

/** What NotificationsService talks to — routes each device to its platform's provider. */
export interface PushDispatcher {
  /** True when at least one platform has a configured provider. */
  isConfigured(): boolean;
  send(targets: PushTarget[], message: PushMessage): Promise<PushSendResult[]>;
}

export const PUSH_DISPATCHER = Symbol('PUSH_DISPATCHER');

/**
 * Placeholder for a platform with no credentials (as of 2026-10-12 no Firebase or APNs credentials
 * exist for this platform). Never attempts delivery, so nothing is ever recorded as SENT for it.
 * Setting the FCM_* / APNS_* variables replaces it (see NotificationsCoreModule).
 */
@Injectable()
export class UnconfiguredPushProvider implements PushProvider {
  readonly name = 'unconfigured';

  isConfigured(): boolean {
    return false;
  }

  send(): Promise<PushSendResult[]> {
    return Promise.reject(
      new Error('No push provider is configured for this environment'),
    );
  }
}
