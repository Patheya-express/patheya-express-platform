import { Processor, WorkerHost } from '@nestjs/bullmq';

import { Job } from 'bullmq';

import { OrdersService } from '../../../modules/orders/services/orders.service';

/**
 * Production Readiness Stage C: concurrency raised from BullMQ's default of 1 — each job targets
 * a distinct `orderId`, and `OrdersService.handleAcceptanceTimeout`'s conditional
 * `transitionIfPending` update already handles the "lost the race to a manual accept/reject"
 * case as a safe no-op, so nothing here relies on jobs running one at a time.
 */
@Processor('orders', { concurrency: 8 })
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
