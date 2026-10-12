import type {
  PushDispatcher,
  PushMessage,
  PushProvider,
  PushSendResult,
  PushTarget,
} from './push-provider';

/**
 * Routes each registered device to the provider for its platform. Device tokens differ by
 * platform: the app's @capacitor/push-notifications plugin returns an FCM registration token on
 * Android but a raw APNs device token on iOS (no Firebase iOS SDK is bundled), and FCM rejects raw
 * APNs tokens — so iOS must go to APNs directly. Devices on a platform without a configured
 * provider (or an unknown platform) are reported `skipped`, never attempted.
 */
export class PlatformPushDispatcher implements PushDispatcher {
  constructor(
    private readonly providers: Readonly<Record<string, PushProvider>>,
  ) {}

  isConfigured(): boolean {
    return Object.values(this.providers).some((provider) =>
      provider.isConfigured(),
    );
  }

  async send(
    targets: PushTarget[],
    message: PushMessage,
  ): Promise<PushSendResult[]> {
    const byPlatform = new Map<string, string[]>();
    for (const target of targets) {
      const tokens = byPlatform.get(target.platform) ?? [];
      tokens.push(target.token);
      byPlatform.set(target.platform, tokens);
    }

    const groups = await Promise.all(
      [...byPlatform].map(async ([platform, tokens]) => {
        const provider = this.providers[platform];

        if (!provider?.isConfigured()) {
          return tokens.map<PushSendResult>((token) => ({
            token,
            outcome: 'skipped',
            error: `No push provider configured for platform "${platform}"`,
          }));
        }

        return provider.send(tokens, message);
      }),
    );

    return groups.flat();
  }
}
