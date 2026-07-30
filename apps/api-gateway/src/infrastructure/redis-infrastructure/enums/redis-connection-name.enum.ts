/**
 * Well-known singleton connection names for future migration. BullMQ/QueueEvents names are
 * per-queue and dynamic (`dispatch`, `notifications`, `payments`, `search`, `tickets`, `orders`),
 * so they're passed as plain strings to the registry rather than enumerated here — only the
 * fixed, one-per-process connections get a named constant.
 */
export enum RedisConnectionName {
  GENERAL = 'redis:general',
  SOCKETIO_PUBLISHER = 'socketio:publisher',
  SOCKETIO_SUBSCRIBER = 'socketio:subscriber',
  BULLMQ_SHARED = 'bullmq:shared',
}
