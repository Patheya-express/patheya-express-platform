import { Injectable, Logger, Optional } from '@nestjs/common';

import { MetricsService } from '../../modules/metrics/metrics.service';

@Injectable()
export class EventBusService {
  private readonly logger = new Logger(EventBusService.name);

  private handlers = new Map<string, Array<(payload: any) => Promise<void>>>();

  constructor(
    // Optional: MetricsModule is @Global(), so this is always available in practice — kept
    // optional defensively so any direct `new EventBusService()` construction (tests, etc.)
    // outside Nest's DI container keeps working without a metrics arg.
    @Optional()
    private readonly metrics?: MetricsService,
  ) {}

  subscribe(
    eventName: string,

    handler: (payload: any) => Promise<void>,
  ) {
    const handlers = this.handlers.get(eventName) || [];

    handlers.push(handler);

    this.handlers.set(eventName, handlers);
  }

  async publish(
    eventName: string,

    payload: any,
  ) {
    this.metrics?.recordEventPublished(eventName);

    const handlers = this.handlers.get(eventName) || [];

    await Promise.all(
      handlers.map((handler) =>
        handler(payload).catch((error) => {
          this.metrics?.recordEventHandlerFailure(eventName);

          this.logger.error(
            `Handler for event "${eventName}" failed: ${error?.message ?? error}`,

            error?.stack,
          );
        }),
      ),
    );
  }
}
