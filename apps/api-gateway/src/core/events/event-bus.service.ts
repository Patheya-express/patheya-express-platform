import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class EventBusService {
  private readonly logger = new Logger(EventBusService.name);

  private handlers = new Map<string, Array<(payload: any) => Promise<void>>>();

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
    const handlers = this.handlers.get(eventName) || [];

    await Promise.all(
      handlers.map((handler) =>
        handler(payload).catch((error) => {
          this.logger.error(
            `Handler for event "${eventName}" failed: ${error?.message ?? error}`,

            error?.stack,
          );
        }),
      ),
    );
  }
}
