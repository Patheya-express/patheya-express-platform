import { Injectable, Logger } from '@nestjs/common';

import { DispatchRepository } from '../repositories/dispatch.repository';

import { QueueService } from '../../../infrastructure/queues/queue.service';

/** Orders older than this with no assignment are considered stranded — long enough that a normal
 *  in-flight `dispatch-assignment` job (including its BullMQ retries) has certainly finished one
 *  way or another, short enough that a genuinely stuck order gets re-attempted well within the
 *  10-minute assignment-expiry window it would otherwise be compared against. */
const STRANDED_THRESHOLD_MS = 3 * 60 * 1000;

/**
 * Production Readiness Stage A (Crash Recovery): closes the same class of gap
 * `PaymentReconciliationService` already closes for payments, applied to dispatch. Even with
 * `dispatch-assignment` now durable and retried (`AssignmentExpiryProcessor`,
 * `DispatchListener`), a job can still exhaust all retries and land in `failed` — most commonly
 * because `assignOrder()` legitimately found zero available partners at the time, not because of
 * a bug. Nothing else re-attempts that order afterward unless another dispatch-relevant event
 * happens to fire for it. This periodic re-scan is that missing re-attempt, run the same way
 * payment reconciliation already is: a repeatable BullMQ job, not a new polling service.
 */
@Injectable()
export class DispatchReconciliationService {
  private readonly logger = new Logger(DispatchReconciliationService.name);

  constructor(
    private readonly dispatchRepository: DispatchRepository,
    private readonly queueService: QueueService,
  ) {}

  async reconcileStrandedAssignments(): Promise<void> {
    const orders = await this.dispatchRepository.findStrandedReadyForPickupOrders(
      STRANDED_THRESHOLD_MS,
    );

    if (orders.length === 0) {
      return;
    }

    this.logger.warn(
      `Found ${orders.length} order(s) ready for pickup with no delivery partner assigned — re-enqueuing dispatch assignment`,
    );

    for (const order of orders) {
      await this.queueService.addDispatchAssignmentJob(order.id, 'reconciliation');
    }
  }
}
