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
}
