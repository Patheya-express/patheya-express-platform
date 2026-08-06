import { Injectable } from '@nestjs/common';

import { RedisService } from '../../../infrastructure/redis/redis.service';

// A partner whose app crashes without ever calling markOffline() should not stay "online"
// forever — the client is expected to refresh this within the window via periodic pings.
const PRESENCE_TTL_SECONDS = 2 * 60;
const ONLINE_AGENTS_SET_KEY = 'support:agents:online';
// Production Readiness Stage D (Observability): mirrors ONLINE_AGENTS_SET_KEY's pattern — without
// this, counting online delivery partners required an expensive SCAN driver:online:* rather than
// a cheap SCARD, and there was no way to feed a Prometheus gauge for it at all.
const ONLINE_DRIVERS_SET_KEY = 'driver:online:set';

@Injectable()
export class PresenceService {
  constructor(private readonly redisService: RedisService) {}

  // -- Support agent presence (C14) — same TTL-based Redis pattern as delivery-partner presence
  // above, under a separate key prefix so the two never collide. The online-agents SET is what
  // lets the admin console enumerate who's online; entries are self-healed (see
  // listOnlineAgentIds) if an agent's TTL expires without an explicit markAgentOffline call.

  async markAgentOnline(agentId: string) {
    const data = { online: true, lastSeen: new Date() };

    // Production Readiness Stage C: the SET and SADD are independent (different keys, no
    // read-your-write dependency), so they're pipelined into a single round trip instead of two
    // sequential ones — this runs on every online ping from every support agent.
    await this.redisService
      .getClient()
      .pipeline()
      .set(
        `agent:online:${agentId}`,
        JSON.stringify(data),
        'EX',
        PRESENCE_TTL_SECONDS,
      )
      .sadd(ONLINE_AGENTS_SET_KEY, agentId)
      .exec();

    return data;
  }

  async markAgentOffline(agentId: string) {
    const data = { online: false, lastSeen: new Date() };

    await this.redisService
      .getClient()
      .pipeline()
      .set(`agent:online:${agentId}`, JSON.stringify(data))
      .srem(ONLINE_AGENTS_SET_KEY, agentId)
      .exec();

    return data;
  }

  async getAgentStatus(agentId: string) {
    const data = await this.redisService.get(`agent:online:${agentId}`);

    if (!data) {
      return { online: false };
    }

    return JSON.parse(data);
  }

  /**
   * Production Readiness Stage C: previously one Redis round trip per agent id (a sequential
   * `for` loop) — the exact N+1 shape `isOnlineBatch` below already exists to eliminate for
   * delivery-partner presence. Now a single `MGET`, same self-healing `srem` for stale ids,
   * batched after the read instead of interleaved with it.
   */
  async listOnlineAgentIds(): Promise<string[]> {
    const client = this.redisService.getClient();
    const ids = await client.smembers(ONLINE_AGENTS_SET_KEY);

    if (ids.length === 0) {
      return [];
    }

    const values = await client.mget(ids.map((id) => `agent:online:${id}`));

    const online: string[] = [];
    const stale: string[] = [];

    ids.forEach((id, index) => {
      if (values[index]) {
        online.push(id);
      } else {
        stale.push(id);
      }
    });

    if (stale.length > 0) {
      await client.srem(ONLINE_AGENTS_SET_KEY, ...stale);
    }

    return online;
  }

  async markOnline(partnerId: string) {
    const data = {
      online: true,

      lastSeen: new Date(),
    };

    // Production Readiness Stage D: SADD into ONLINE_DRIVERS_SET_KEY alongside the existing TTL
    // key, same pipelined pattern as markAgentOnline — enables a cheap SCARD-based online count
    // for patheya_delivery_partners_online, instead of no way to count online partners at all.
    await this.redisService
      .getClient()
      .pipeline()
      .set(
        `driver:online:${partnerId}`,
        JSON.stringify(data),
        'EX',
        PRESENCE_TTL_SECONDS,
      )
      .sadd(ONLINE_DRIVERS_SET_KEY, partnerId)
      .exec();

    return data;
  }

  async markOffline(partnerId: string) {
    const data = {
      online: false,

      lastSeen: new Date(),
    };

    await this.redisService
      .getClient()
      .pipeline()
      .set(`driver:online:${partnerId}`, JSON.stringify(data))
      .srem(ONLINE_DRIVERS_SET_KEY, partnerId)
      .exec();

    return data;
  }

  /** Production Readiness Stage D (Observability): backs patheya_delivery_partners_online. Same
   *  self-healing shape as listOnlineAgentIds — a partner whose TTL key expired without an
   *  explicit markOffline call (app crash) is pruned from the set on the next count, so it
   *  converges even without ONLINE_DRIVERS_SET_KEY being perfectly maintained. */
  async countOnlinePartners(): Promise<number> {
    const client = this.redisService.getClient();
    const ids = await client.smembers(ONLINE_DRIVERS_SET_KEY);

    if (ids.length === 0) {
      return 0;
    }

    const values = await client.mget(ids.map((id) => `driver:online:${id}`));

    const stale = ids.filter((_, index) => !values[index]);

    if (stale.length > 0) {
      await client.srem(ONLINE_DRIVERS_SET_KEY, ...stale);
    }

    return ids.length - stale.length;
  }

  async getStatus(partnerId: string) {
    const data = await this.redisService.get(`driver:online:${partnerId}`);

    if (!data) {
      return {
        online: false,
      };
    }

    return JSON.parse(data);
  }

  async isOnline(partnerId: string) {
    const status = await this.getStatus(partnerId);

    return status.online === true;
  }

  /**
   * Batched equivalent of calling `isOnline` once per id in a loop — one Redis round trip via
   * `MGET` instead of N sequential ones. Added for `DispatchService.assignOrder` (the automatic
   * dispatch hot path, previously a sequential `for`-loop of individual `isOnline` calls) and
   * `AdminDispatchService.getAvailablePartners` (production-validation performance finding).
   */
  async isOnlineBatch(partnerIds: string[]): Promise<Map<string, boolean>> {
    if (partnerIds.length === 0) {
      return new Map();
    }

    const client = this.redisService.getClient();

    const values = await client.mget(
      partnerIds.map((partnerId) => `driver:online:${partnerId}`),
    );

    return new Map(
      partnerIds.map((partnerId, index) => {
        const raw = values[index];

        if (!raw) {
          return [partnerId, false] as const;
        }

        try {
          const parsed = JSON.parse(raw) as { online?: boolean };

          return [partnerId, parsed.online === true] as const;
        } catch {
          return [partnerId, false] as const;
        }
      }),
    );
  }

  /**
   * Enterprise Dispatch Engine Enhancement — DispatchService's "longest idle" priority tiebreak
   * needs `lastSeen`, not just the boolean `isOnlineBatch` already returns. Same `driver:online:*`
   * key/JSON shape `markOnline` already writes (`{ online, lastSeen }`), just reading the second
   * field — no new Redis key, no new write path. A missing/unparsable key returns `null`
   * (partner has no recent presence signal), which callers should treat as "least preferred" for
   * an idle-time sort, not as "most idle".
   */
  async getLastSeenBatch(
    partnerIds: string[],
  ): Promise<Map<string, Date | null>> {
    if (partnerIds.length === 0) {
      return new Map();
    }

    const client = this.redisService.getClient();

    const values = await client.mget(
      partnerIds.map((partnerId) => `driver:online:${partnerId}`),
    );

    return new Map(
      partnerIds.map((partnerId, index) => {
        const raw = values[index];

        if (!raw) {
          return [partnerId, null] as const;
        }

        try {
          const parsed = JSON.parse(raw) as { lastSeen?: string };

          return [
            partnerId,
            parsed.lastSeen ? new Date(parsed.lastSeen) : null,
          ] as const;
        } catch {
          return [partnerId, null] as const;
        }
      }),
    );
  }
}
