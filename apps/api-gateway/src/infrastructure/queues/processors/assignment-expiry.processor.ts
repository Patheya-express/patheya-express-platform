import { Processor, WorkerHost } from '@nestjs/bullmq';

import { Job } from 'bullmq';

import { AssignmentStatus, AuditAction } from '@prisma/client';

import { DispatchRepository } from '../../../modules/dispatch/repositories/dispatch.repository';

import { DispatchService } from '../../../modules/dispatch/services/dispatch.service';

import { DispatchReconciliationService } from '../../../modules/dispatch/services/dispatch-reconciliation.service';

import { EventBusService } from '../../../core/events/event-bus.service';

import { RealtimeService } from '../../../modules/realtime/services/realtime.service';

import { AuditService } from '../../../modules/audit/services/audit.service';

import { AppLoggerService } from '../../logger/logger.service';

import { MetricsService } from '../../../modules/metrics/metrics.service';

interface AssignmentExpiryJobData {
  assignmentId: string;
}

interface DispatchAssignmentJobData {
  orderId: string;
  sourceEvent: string;
}

/**
 * The single Worker for the `dispatch` queue — every job name on this queue must be handled here
 * (not in a second `@Processor('dispatch')` class), since `@nestjs/bullmq` creates one independent
 * BullMQ `Worker` per decorated class: two classes on the same queue name would mean two workers
 * both consuming from it, silently doubling `dispatch`'s concurrency and Redis connections rather
 * than sharing one. `dispatch-assignment` (Production Readiness Stage A — Event Reliability) was
 * added here for that reason: `DispatchListener` used to call `DispatchService.assignOrder()`
 * directly and synchronously from its `EventBusService` handler, with no retry if that call
 * failed transiently; it now enqueues this job instead (`QueueService.addDispatchAssignmentJob`),
 * giving the same call BullMQ's durability and retry/backoff. `dispatch-reconciliation`
 * (Production Readiness Stage A — Crash Recovery) is the periodic re-scan for orders a
 * `dispatch-assignment` job never successfully assigned (see `DispatchReconciliationService`).
 */
/**
 * Production Readiness Stage C: concurrency raised from BullMQ's default of 1. Every job on this
 * queue (`dispatch-assignment`, `assignment-expiry`, `dispatch-reconciliation`) is scoped to a
 * distinct `orderId`/`assignmentId`, and correctness against a racing job for the *same* order
 * is already carried by an atomic conditional DB update, not by BullMQ serialization —
 * `claimAssignmentTransition` above (line ~122) is exactly that: "the loser silently no-ops
 * rather than expiring an assignment that was, in fact, just accepted a moment before." Since
 * cross-job races are already resolved at the DB layer, there is no ordering property left for
 * concurrency=1 to protect, only throughput it was costing. 8 chosen conservatively for the same
 * reason as the notifications queue (I/O-bound job bodies, no production load data to justify
 * going higher yet).
 */
@Processor('dispatch', { concurrency: 8 })
export class AssignmentExpiryProcessor extends WorkerHost {
  constructor(
    private readonly dispatchRepository: DispatchRepository,

    private readonly dispatchService: DispatchService,

    private readonly dispatchReconciliationService: DispatchReconciliationService,

    private readonly eventBus: EventBusService,

    private readonly realtimeService: RealtimeService,

    private readonly auditService: AuditService,

    private readonly logger: AppLoggerService,

    private readonly metrics: MetricsService,
  ) {
    super();
  }

  async process(job: Job<AssignmentExpiryJobData | DispatchAssignmentJobData>) {
    if (job.name === 'dispatch-reconciliation') {
      await this.dispatchReconciliationService.reconcileStrandedAssignments();

      return;
    }

    if (job.name === 'dispatch-assignment') {
      const data = job.data as DispatchAssignmentJobData;

      this.logger.log(
        {
          event: 'dispatch_assignment_job_started',
          orderId: data.orderId,
          sourceEvent: data.sourceEvent,
          attempt: job.attemptsMade + 1,
        },
        'AssignmentExpiryProcessor',
      );

      this.metrics.recordDispatchAssignmentAttempt(data.sourceEvent);

      if (data.sourceEvent !== 'order.ready') {
        this.metrics.recordDispatchRedispatch(data.sourceEvent);
      }

      const assignmentStart = Date.now();

      await this.dispatchService.assignOrder(data.orderId);

      this.metrics.observeDispatchAssignmentDuration(
        (Date.now() - assignmentStart) / 1000,
      );

      return;
    }

    if (job.name !== 'assignment-expiry') {
      return;
    }

    const expiryData = job.data as AssignmentExpiryJobData;

    const assignment = await this.dispatchRepository.findAssignmentById(
      expiryData.assignmentId,
    );

    if (!assignment) {
      return;
    }

    // Claim, don't trust the read above — a partner's acceptAssignment (or a reject) may be
    // committing concurrently right now. Only the caller whose claim actually flips the row
    // (count === 1) is allowed to fire the expiry side effects; the loser silently no-ops rather
    // than expiring an assignment that was, in fact, just accepted a moment before.
    const claim = await this.dispatchRepository.claimAssignmentTransition(
      assignment.id,

      [AssignmentStatus.PENDING],

      AssignmentStatus.EXPIRED,
    );

    if (claim.count === 1) {
      this.logger.log(
        {
          event: 'dispatch_assignment_expired',
          assignmentId: assignment.id,
          orderId: assignment.orderId,
        },
        'AssignmentExpiryProcessor',
      );

      await this.auditService.log(
        null,
        'DeliveryAssignment',
        assignment.id,
        AuditAction.STATUS_CHANGE,
        { status: AssignmentStatus.PENDING },
        { event: 'ASSIGNMENT_EXPIRED', status: AssignmentStatus.EXPIRED },
      );

      // Realtime-notify the partner whose assignment just lapsed — previously silent; the
      // partner's app had no way to know the offer disappeared until it polled again.
      const partner = await this.dispatchRepository.findPartnerById(
        assignment.deliveryPartnerId,
      );

      if (partner) {
        this.realtimeService.emitToUser(
          partner.userId,

          'delivery.assignment.expired',

          {
            assignmentId: assignment.id,

            orderId: assignment.orderId,
          },
        );
      }

      await this.eventBus.publish(
        'dispatch.assignment.expired',

        {
          orderId: assignment.orderId,

          assignmentId: assignment.id,
        },
      );
    }
  }
}
