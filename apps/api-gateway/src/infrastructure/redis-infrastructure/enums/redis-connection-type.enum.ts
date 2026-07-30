/**
 * Categorizes what a Redis connection is used for. Existing connections today map to these
 * values conceptually (not yet in code — see the module-level doc on `RedisInfrastructureModule`
 * for why): `RedisService` -> GENERAL, `MetricsService`'s per-queue `QueueEvents` ->
 * BULLMQ_QUEUE_EVENTS, `RealtimeGateway`'s adapter pair -> SOCKETIO_PUBLISHER/SOCKETIO_SUBSCRIBER.
 * CACHE and PUBSUB are reserved for features that don't exist yet.
 *
 * BULLMQ_SHARED (added for the BullMQ shared-connection migration): tags the one diagnostic
 * connection registered as representative of the shared `RedisOptions` template every BullMQ
 * `Queue`/`Worker` in this process is independently constructed from (see
 * `BullmqSharedConnectionObserver`'s doc comment for why "shared" describes the config, not a
 * single live socket). BULLMQ_QUEUE/BULLMQ_WORKER remain reserved for a future sprint that
 * chooses to register each individual queue/worker connection instead of just the one
 * representative.
 */
export enum RedisConnectionType {
  GENERAL = 'GENERAL',
  BULLMQ_QUEUE = 'BULLMQ_QUEUE',
  BULLMQ_WORKER = 'BULLMQ_WORKER',
  BULLMQ_SHARED = 'BULLMQ_SHARED',
  BULLMQ_QUEUE_EVENTS = 'BULLMQ_QUEUE_EVENTS',
  SOCKETIO_PUBLISHER = 'SOCKETIO_PUBLISHER',
  SOCKETIO_SUBSCRIBER = 'SOCKETIO_SUBSCRIBER',
  CACHE = 'CACHE',
  PUBSUB = 'PUBSUB',
}
