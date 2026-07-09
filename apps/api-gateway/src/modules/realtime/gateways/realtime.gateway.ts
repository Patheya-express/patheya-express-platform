import { Logger } from '@nestjs/common';

import { JwtService } from '@nestjs/jwt';

import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';

import { Server, Socket } from 'socket.io';

import { UserRole } from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import {
  AuthenticatedUser,
  canAccessOrder,
  canAccessRestaurant,
} from '../../../shared/authorization/order-access.util';

interface JoinRoomResult {
  success: boolean;
  room?: string;
  error?: string;
}

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwtService: JwtService,

    private readonly prisma: PrismaService,
  ) {}

  /**
   * Every socket must present a valid access token on connect (via `auth.token` — the
   * conventional socket.io-client option — or a bearer Authorization header). Unauthenticated
   * sockets are disconnected immediately; this is what makes room-join authorization possible
   * at all, since it's the only place the connecting user's identity is established.
   */
  handleConnection(client: Socket) {
    const token = this.extractToken(client);

    if (!token) {
      this.logger.warn(`Rejected unauthenticated connection: ${client.id}`);
      client.disconnect(true);
      return;
    }

    try {
      const payload = this.jwtService.verify(token, {
        secret: process.env.JWT_ACCESS_SECRET,
      });

      client.data.user = {
        userId: payload.sub,
        role: payload.role,
      } satisfies AuthenticatedUser;

      this.logger.log(`Connected: ${client.id} (user ${payload.sub})`);
    } catch {
      this.logger.warn(`Rejected connection with invalid token: ${client.id}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Disconnected: ${client.id}`);
  }

  private extractToken(client: Socket): string | undefined {
    const authToken = client.handshake.auth?.['token'] as string | undefined;

    if (authToken) {
      return authToken;
    }

    const header = client.handshake.headers.authorization;

    if (header?.startsWith('Bearer ')) {
      return header.slice(7);
    }

    return undefined;
  }

  /**
   * Room naming convention: `user:<userId>`, `order:<orderId>`, `restaurant:<restaurantId>`.
   * A socket may only join a room it's actually entitled to — a customer their own orders and
   * user room, a delivery partner their own user room and assigned-order rooms, a restaurant
   * owner/manager their own restaurant's rooms, and admins unrestricted.
   */
  @SubscribeMessage('join-room')
  async joinRoom(
    @ConnectedSocket()
    client: Socket,

    @MessageBody()
    room: string,
  ): Promise<JoinRoomResult> {
    const user = client.data.user as AuthenticatedUser | undefined;

    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    const allowed = await this.isAuthorizedForRoom(room, user);

    if (!allowed) {
      this.logger.warn(`User ${user.userId} denied join to room "${room}"`);
      return { success: false, error: 'Not authorized for this room' };
    }

    await client.join(room);

    return {
      success: true,

      room,
    };
  }

  private async isAuthorizedForRoom(
    room: string,
    user: AuthenticatedUser,
  ): Promise<boolean> {
    if (user.role === UserRole.ADMIN || user.role === UserRole.SUPER_ADMIN) {
      return true;
    }

    // Broadcast room for the support-agent console — any staff member can join to receive
    // live new-ticket/ticket-updated pushes for the queue view.
    if (room === 'support-queue') {
      return user.role === UserRole.SUPPORT_AGENT;
    }

    const separatorIndex = room.indexOf(':');

    if (separatorIndex === -1) {
      return false;
    }

    const prefix = room.slice(0, separatorIndex);
    const id = room.slice(separatorIndex + 1);

    if (!id) {
      return false;
    }

    if (prefix === 'user') {
      return id === user.userId;
    }

    if (prefix === 'order') {
      const order = await this.prisma.order.findUnique({
        where: { id },
        select: {
          customerId: true,
          restaurantId: true,
          deliveryPartnerId: true,
        },
      });

      if (!order) {
        return false;
      }

      return canAccessOrder(this.prisma, order, user);
    }

    if (prefix === 'restaurant') {
      return canAccessRestaurant(this.prisma, id, user);
    }

    if (prefix === 'ticket') {
      if (user.role === UserRole.SUPPORT_AGENT) {
        return true;
      }

      const ticket = await this.prisma.supportTicket.findUnique({
        where: { id },
        select: { customerId: true },
      });

      return ticket?.customerId === user.userId;
    }

    return false;
  }
}
