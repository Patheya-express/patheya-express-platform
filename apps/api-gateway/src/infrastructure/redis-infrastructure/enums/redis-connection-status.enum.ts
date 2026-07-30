/** Mirrors ioredis's own client lifecycle events (`connect`/`ready`/`reconnecting`/`close`/`end`),
 *  plus an explicit `ERROR` state the registry sets on the most recent unhandled error event. */
export enum RedisConnectionStatus {
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  READY = 'ready',
  RECONNECTING = 'reconnecting',
  CLOSED = 'closed',
  ENDED = 'ended',
  ERROR = 'error',
}
