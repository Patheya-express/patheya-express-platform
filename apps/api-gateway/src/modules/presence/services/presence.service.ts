import {
    Injectable,
  } from '@nestjs/common';
  
  import { RedisService }
  from '../../../infrastructure/redis/redis.service';
  
  @Injectable()
  export class PresenceService {
  
    constructor(
  
      private readonly redisService:
        RedisService,
  
    ) {}
  
    async markOnline(
      partnerId: string,
    ) {
  
      const data = {
  
        online: true,
  
        lastSeen:
          new Date(),
  
      };
  
      await this.redisService.set(
  
        `driver:online:${partnerId}`,
  
        JSON.stringify(data),
  
      );
  
      return data;
  
    }
  
    async markOffline(
      partnerId: string,
    ) {
  
      const data = {
  
        online: false,
  
        lastSeen:
          new Date(),
  
      };
  
      await this.redisService.set(
  
        `driver:online:${partnerId}`,
  
        JSON.stringify(data),
  
      );
  
      return data;
  
    }
  
    async getStatus(
      partnerId: string,
    ) {
  
      const data =
  
        await this.redisService.get(
  
          `driver:online:${partnerId}`,
  
        );
  
      if (!data) {
  
        return {
  
          online: false,
  
        };
  
      }
  
      return JSON.parse(data);
  
    }
  
    async isOnline(
      partnerId: string,
    ) {
  
      const status =
  
        await this.getStatus(
          partnerId,
        );
  
      return status.online === true;
  
    }
  
  }