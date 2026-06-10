import {
    Injectable,
    OnModuleInit,
  } from '@nestjs/common';
  
  import { EventBusService }
  from '../../../core/events/event-bus.service';
  
  import { NotificationsService }
  from '../services/notifications.service';
  
  @Injectable()
  export class OrderNotificationListener
  implements OnModuleInit {
  
    constructor(
  
      private readonly eventBus:
        EventBusService,
  
      private readonly notificationsService:
        NotificationsService,
  
    ) {}
  
    onModuleInit() {
  
      this.eventBus.subscribe(
  
        'order.placed',
  
        async (event) => {
  
          await this.notificationsService
            .createNotification(
  
              event.customerId,
  
              'Order Placed',
  
              `Order ${event.orderId} has been placed.`,
  
            );
  
        },
  
      );
  
    }
  
  }