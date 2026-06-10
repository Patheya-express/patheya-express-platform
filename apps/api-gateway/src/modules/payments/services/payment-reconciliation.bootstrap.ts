import {
    Injectable,
    OnModuleInit,
  } from '@nestjs/common';
  
  import {
    QueueService,
  } from '../../../infrastructure/queues/queue.service';
  
  @Injectable()
  export class PaymentReconciliationBootstrap
  implements OnModuleInit {
  
    constructor(
  
      private readonly queueService:
        QueueService,
  
    ) {}
  
    async onModuleInit() {
  
      await this.queueService
        .addPaymentReconciliationJob();
  
    }
  
  }