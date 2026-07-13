import { Processor, WorkerHost } from '@nestjs/bullmq';

import { Job } from 'bullmq';

import { OrdersService } from '../../../modules/orders/services/orders.service';

@Processor('orders')
export class OrderAcceptanceTimeoutProcessor extends WorkerHost {
  constructor(private readonly ordersService: OrdersService) {
    super();
  }

  async process(job: Job) {
    if (job.name !== 'order-acceptance-timeout') {
      return;
    }

    await this.ordersService.handleAcceptanceTimeout(job.data.orderId);
  }
}
