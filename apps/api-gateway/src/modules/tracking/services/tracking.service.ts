import { ForbiddenException, Injectable } from '@nestjs/common';

import { UserRole } from '@prisma/client';

import { RedisService } from '../../../infrastructure/redis/redis.service';

import { RealtimeService } from '../../realtime/services/realtime.service';

import { OrdersService } from '../../orders/services/orders.service';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import { AuthenticatedUser } from '../../../shared/authorization/order-access.util';

import { haversineDistanceKm } from '../../restaurants/utils/geo.util';

// Live location keys are short-lived — if a driver's app crashes mid-delivery without a final
// update, stale coordinates shouldn't linger indefinitely (see Redis TTL fix, Phase C6).
const TRACKING_TTL_SECONDS = 15 * 60;

// No routing/traffic API is configured, so ETA is a straight-line-distance estimate at an
// assumed average urban delivery speed rather than a real routed ETA.
const ASSUMED_AVERAGE_SPEED_KMH = 25;

export interface OrderLocation {
  latitude: number;
  longitude: number;
  updatedAt: Date;
  distanceKm?: number;
  etaMinutes?: number;
}

@Injectable()
export class TrackingService {
  constructor(
    private readonly redisService: RedisService,

    private readonly realtimeService: RealtimeService,

    private readonly ordersService: OrdersService,

    private readonly prisma: PrismaService,
  ) {}

  /** Only the order's assigned delivery partner (or an admin) may push a location update for it. */
  async updateLocation(
    orderId: string,

    latitude: number,

    longitude: number,

    user: AuthenticatedUser,
  ): Promise<OrderLocation> {
    const order = await this.ordersService.getOrderOwnership(orderId);

    const isAdmin =
      user.role === UserRole.ADMIN || user.role === UserRole.SUPER_ADMIN;
    const isAssignedPartner =
      user.role === UserRole.DELIVERY_PARTNER &&
      order.deliveryPartnerId === user.userId;

    if (!isAdmin && !isAssignedPartner) {
      throw new ForbiddenException(
        "Only the order's assigned delivery partner can update its location",
      );
    }

    let distanceKm: number | undefined;
    let etaMinutes: number | undefined;

    if (order.latitude != null && order.longitude != null) {
      distanceKm = haversineDistanceKm(
        latitude,
        longitude,
        order.latitude,
        order.longitude,
      );
      etaMinutes = Math.max(
        1,
        Math.round((distanceKm / ASSUMED_AVERAGE_SPEED_KMH) * 60),
      );
    }

    const trackingData: OrderLocation = {
      latitude,
      longitude,
      updatedAt: new Date(),
      distanceKm,
      etaMinutes,
    };

    await this.redisService.set(
      `tracking:order:${orderId}`,

      JSON.stringify(trackingData),

      TRACKING_TTL_SECONDS,
    );

    // Redis remains the authoritative "current" location; this is only a last-known snapshot
    // for the partner's own profile (e.g. admin dashboards), and is deliberately best-effort.
    if (order.deliveryPartnerId) {
      await this.prisma.deliveryPartner.updateMany({
        where: { userId: order.deliveryPartnerId },
        data: { currentLatitude: latitude, currentLongitude: longitude },
      });
    }

    this.realtimeService.emitToOrder(
      orderId,
      'tracking.location',
      trackingData,
    );

    return trackingData;
  }

  /** Anyone with read access to the order (customer, assigned partner, restaurant, admin) can read its live location. */
  async getOrderLocation(
    orderId: string,
    user: AuthenticatedUser,
  ): Promise<OrderLocation | null> {
    await this.ordersService.assertOrderAccessById(orderId, user);

    const data = await this.redisService.get(`tracking:order:${orderId}`);

    if (!data) {
      return null;
    }

    return JSON.parse(data) as OrderLocation;
  }
}
