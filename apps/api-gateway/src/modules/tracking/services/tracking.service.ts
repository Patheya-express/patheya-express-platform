import { Injectable } from '@nestjs/common';

import { RedisService } from '../../../infrastructure/redis/redis.service';

import { RealtimeService } from '../../realtime/services/realtime.service';

@Injectable()
export class TrackingService {
  constructor(
    private readonly redisService: RedisService,

    private readonly realtimeService: RealtimeService,
  ) {}

  async updateLocation(
    orderId: string,

    latitude: number,

    longitude: number,
  ) {
    const trackingData = {
      latitude,

      longitude,

      updatedAt: new Date(),
    };

    await this.redisService.set(
      `tracking:order:${orderId}`,

      JSON.stringify(trackingData),
    );

    this.realtimeService.emitToOrder(
      orderId,

      'tracking.location',

      trackingData,
    );

    return trackingData;
  }

  async getOrderLocation(orderId: string) {
    const data = await this.redisService.get(`tracking:order:${orderId}`);

    if (!data) {
      return null;
    }

    return JSON.parse(data);
  }
}
