import { Injectable } from '@nestjs/common';

import { RedisService } from '../../../infrastructure/redis/redis.service';

// A partner whose app crashes without ever calling markOffline() should not stay "online"
// forever — the client is expected to refresh this within the window via periodic pings.
const PRESENCE_TTL_SECONDS = 2 * 60;
const ONLINE_AGENTS_SET_KEY = 'support:agents:online';

@Injectable()
export class PresenceService {
  constructor(private readonly redisService: RedisService) {}

  // -- Support agent presence (C14) — same TTL-based Redis pattern as delivery-partner presence
  // above, under a separate key prefix so the two never collide. The online-agents SET is what
  // lets the admin console enumerate who's online; entries are self-healed (see
  // listOnlineAgentIds) if an agent's TTL expires without an explicit markAgentOffline call.

  async markAgentOnline(agentId: string) {
    const data = { online: true, lastSeen: new Date() };

    await this.redisService.set(
      `agent:online:${agentId}`,
      JSON.stringify(data),
      PRESENCE_TTL_SECONDS,
    );

    await this.redisService.getClient().sadd(ONLINE_AGENTS_SET_KEY, agentId);

    return data;
  }

  async markAgentOffline(agentId: string) {
    const data = { online: false, lastSeen: new Date() };

    await this.redisService.set(
      `agent:online:${agentId}`,
      JSON.stringify(data),
    );
    await this.redisService.getClient().srem(ONLINE_AGENTS_SET_KEY, agentId);

    return data;
  }

  async getAgentStatus(agentId: string) {
    const data = await this.redisService.get(`agent:online:${agentId}`);

    if (!data) {
      return { online: false };
    }

    return JSON.parse(data);
  }

  async listOnlineAgentIds(): Promise<string[]> {
    const client = this.redisService.getClient();
    const ids = await client.smembers(ONLINE_AGENTS_SET_KEY);

    const online: string[] = [];

    for (const id of ids) {
      const raw = await this.redisService.get(`agent:online:${id}`);

      if (raw) {
        online.push(id);
      } else {
        await client.srem(ONLINE_AGENTS_SET_KEY, id);
      }
    }

    return online;
  }

  async markOnline(partnerId: string) {
    const data = {
      online: true,

      lastSeen: new Date(),
    };

    await this.redisService.set(
      `driver:online:${partnerId}`,

      JSON.stringify(data),

      PRESENCE_TTL_SECONDS,
    );

    return data;
  }

  async markOffline(partnerId: string) {
    const data = {
      online: false,

      lastSeen: new Date(),
    };

    await this.redisService.set(
      `driver:online:${partnerId}`,

      JSON.stringify(data),
    );

    return data;
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
}
