import { Logger } from '@nestjs/common';

import { JwtService } from '@nestjs/jwt';

import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';

import { Server, Socket } from 'socket.io';

import { createAdapter } from '@socket.io/redis-adapter';

import { UserRole } from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import { RedisConnectionFactory } from '../../../infrastructure/redis-infrastructure/redis-connection-factory.service';

import { RedisConnectionType } from '../../../infrastructure/redis-infrastructure/enums/redis-connection-type.enum';

import { RedisConnectionName } from '../../../infrastructure/redis-infrastructure/enums/redis-connection-name.enum';

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

/** Same allowlist `main.ts`'s `buildCorsOriginValidator` enforces for the REST API — this decorator
 *  config is evaluated once at module load (no ConfigService/DI available yet), so it reads
 *  `process.env` directly rather than sharing that function verbatim. Previously hardcoded
 *  `origin: '*'`, flagged as inconsistent since Phase 1A's audit
 *  (`docs/infrastructure/socketio.md`) — fixed here rather than left for a future phase. */
const LOCALHOST_ORIGIN_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/** Sprint 1.6 — matches main.ts's normalizeOrigin exactly: strips a trailing slash so a
 *  configured value like `https://app.example.com/` still matches the browser's `Origin` header
 *  (which never has one). Without this, a frontend URL with a trailing slash passed the REST
 *  API's CORS check but was silently rejected here, purely from the two independent
 *  implementations drifting. */
function normalizeOrigin(origin: string): string {
  return origin.replace(/\/+$/, '');
}

function buildRealtimeCorsOrigin(
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
): void {
  if (!origin) {
    callback(null, true);
    return;
  }

  const allowedOrigins = [
    process.env.CUSTOMER_APP_URL,
    process.env.RESTAURANT_APP_URL,
    process.env.ADMIN_APP_URL,
    process.env.DELIVERY_APP_URL,
  ]
    .filter((value): value is string => Boolean(value))
    .map(normalizeOrigin);

  if (allowedOrigins.includes(normalizeOrigin(origin))) {
    callback(null, true);
    return;
  }

  if (
    process.env.NODE_ENV !== 'production' &&
    LOCALHOST_ORIGIN_PATTERN.test(origin)
  ) {
    callback(null, true);
    return;
  }

  callback(new Error(`Origin "${origin}" is not allowed by CORS`), false);
}

@WebSocketGateway({
  cors: {
    origin: buildRealtimeCorsOrigin,
    credentials: true,
  },
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit
{
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwtService: JwtService,

    private readonly prisma: PrismaService,

    private readonly redisConnectionFactory: RedisConnectionFactory,
  ) {}

  /**
   * Closes the cross-pod fanout gap `docs/infrastructure/socketio.md` and
   * `cloud-architecture-blueprint.md` Section 6/8 both flagged as a known, scheduled-but-not-yet-
   * built gap: without this adapter, `server.to(room).emit()` only reaches sockets connected to
   * the *same* pod, and only nginx's cookie-based sticky-session affinity (`k8s/base/ingress.yaml`)
   * papered over it — which cannot guarantee two independent clients (e.g. a delivery partner and
   * the customer tracking them) ever land on the same pod. Two dedicated ioredis connections
   * (never the shared `RedisService`/BullMQ connections — the adapter's pub/sub subscriber
   * connection cannot issue any other command once subscribed, so it must never be shared).
   *
   * Connection creation moved onto `RedisConnectionFactory` (Redis Infrastructure migration).
   * `createConnection()` builds its options via `RedisConfigurationService.getDefaultOptions()` —
   * the same `getRedisConnectionOptions()` this file used to call directly — so `pubClient` is
   * constructed identically to before. `duplicateConnection()` calls `pubClient.duplicate()`
   * internally (verified in `@socket.io/redis-adapter`'s own source: `createAdapter` stores
   * whatever clients it's given and calls `.publish()`/`.subscribe()`/`.on('error', ...)` on them
   * directly — no further wrapping or duplication of its own), so `subClient` is the exact same
   * kind of duplicate as `pubClient.duplicate()` produced before. The only difference is that both
   * are now registered with the Redis connection registry and instrumented — observational
   * additions, not behavior changes.
   */
  afterInit(server: Server): void {
    const pubClient = this.redisConnectionFactory.createConnection({
      name: RedisConnectionName.SOCKETIO_PUBLISHER,
      type: RedisConnectionType.SOCKETIO_PUBLISHER,
      owner: 'RealtimeGateway',
      purpose: 'Socket.IO Redis adapter publisher',
    });

    const subClient = this.redisConnectionFactory.duplicateConnection(pubClient, {
      name: RedisConnectionName.SOCKETIO_SUBSCRIBER,
      type: RedisConnectionType.SOCKETIO_SUBSCRIBER,
      owner: 'RealtimeGateway',
      purpose: 'Socket.IO Redis adapter subscriber',
    });

    server.adapter(createAdapter(pubClient, subClient));

    this.logger.log(
      'Socket.IO Redis adapter attached — cross-pod fanout enabled',
    );
  }

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

  /**
   * Force-disconnects every socket belonging to this user, across every device/tab and every
   * pod (via the Redis adapter attached in afterInit — `disconnectSockets` is adapter-aware, not
   * just local to this process). Used by UsersService on suspend/block, where the whole account
   * should lose realtime access immediately, not just the one session being acted on. Relies on
   * the client having already joined its own `user:<id>` room (which every authenticated client
   * does today for notifications/wallet/order-tracking pushes) — a socket that never joined that
   * room will still be rejected on its next `join-room`/HTTP call by the blacklist/blocked check
   * (jwt.strategy.ts), so this is a fast-path, not the only backstop.
   */
  disconnectUser(userId: string): void {
    void this.server.in(`user:${userId}`).disconnectSockets(true);
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
