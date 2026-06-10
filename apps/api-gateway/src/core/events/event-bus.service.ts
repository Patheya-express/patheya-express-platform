import {
    Injectable,
  } from '@nestjs/common';
  
  @Injectable()
  export class EventBusService {
  
    private handlers = new Map<
      string,
      Array<(payload: any) => Promise<void>>
    >();
  
    subscribe(
  
      eventName: string,
  
      handler: (
        payload: any,
      ) => Promise<void>,
  
    ) {
  
      const handlers =
  
        this.handlers.get(
          eventName,
        ) || [];
  
      handlers.push(handler);
  
      this.handlers.set(
        eventName,
        handlers,
      );
  
    }
  
    async publish(
  
      eventName: string,
  
      payload: any,
  
    ) {
  
      const handlers =
  
        this.handlers.get(
          eventName,
        ) || [];
  
      await Promise.all(
  
        handlers.map(
          (handler) =>
            handler(payload),
        ),
  
      );
  
    }
  
  }