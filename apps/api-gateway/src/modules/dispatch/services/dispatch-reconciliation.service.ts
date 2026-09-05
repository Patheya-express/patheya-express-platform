import { Injectable, Logger } from '@nestjs/common';

import { DispatchRepository } from '../repositories/dispatch.repository';

import { QueueService } from '../../../infrastructure/queues/queue.service';

import { MetricsService } from '../../metrics/metrics.service';

/** Orders older than this with no assignment are considered stranded — long enough that a normal
 *  in-flight `dispatch-assignment` job (including its BullMQ retries, and, since the Enterprise
 *  Dispatch Engine Enhancement, several full DISPATCH_ASSIGNMENT_TIMEOUT_SECONDS/
 *  DISPATCH_CYCLE_RETRY_SECONDS cycles at their default 15s each) has certainly finished one way
 *  or another, short enough that a genuinely stuck order still gets re-attempted promptly. Left
 *  at its pre-existing value — still comfortably conservative against the new, much shorter
 *  default cycle timescale, so no change was needed to the threshold itself, only this comment's
 *  stale "10-minute assignment-expiry window" reasoning. */
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
    private readonly metrics: MetricsService,
  ) {}

  async reconcileStrandedAssignments(): Promise<void> {
    const orders =
      await this.dispatchRepository.findStrandedReadyForPickupOrders(
        STRANDED_THRESHOLD_MS,
      );

    // Recorded even when zero — a gauge left unset after the last non-zero run would keep
    // reporting stale data forever instead of reflecting "nothing stranded right now".
    this.metrics.recordDispatchReconciliationRun(orders.length);

    if (orders.length === 0) {
      return;
    }

    this.logger.warn(
      `Found ${orders.length} order(s) ready for pickup with no delivery partner assigned — re-enqueuing dispatch assignment`,
    );

    for (const order of orders) {
      await this.queueService.addDispatchAssignmentJob(
        order.id,
        'reconciliation',
      );
    }
  }
}
