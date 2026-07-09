import { Injectable } from '@nestjs/common';

import { RealtimeGateway } from '../gateways/realtime.gateway';

@Injectable()
export class RealtimeService {
  constructor(private readonly gateway: RealtimeGateway) {}

  emitToUser(
    userId: string,

    event: string,

    payload: any,
  ) {
    this.gateway.server.to(`user:${userId}`).emit(
      event,

      payload,
    );
  }

  emitToRestaurant(
    restaurantId: string,

    event: string,

    payload: any,
  ) {
    this.gateway.server.to(`restaurant:${restaurantId}`).emit(
      event,

      payload,
    );
  }

  emitToOrder(
    orderId: string,

    event: string,

    payload: any,
  ) {
    this.gateway.server.to(`order:${orderId}`).emit(
      event,

      payload,
    );
  }

  /** Generic room emitter for rooms without a dedicated helper above (e.g. `ticket:<id>`, `support-queue`). */
  emitToRoom(room: string, event: string, payload: any) {
    this.gateway.server.to(room).emit(event, payload);
  }
}
