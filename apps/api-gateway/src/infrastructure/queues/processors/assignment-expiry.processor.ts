import { Processor, WorkerHost } from '@nestjs/bullmq';

import { Job } from 'bullmq';

import { AssignmentStatus, AuditAction } from '@prisma/client';

import { DispatchRepository } from '../../../modules/dispatch/repositories/dispatch.repository';

import { EventBusService } from '../../../core/events/event-bus.service';

import { RealtimeService } from '../../../modules/realtime/services/realtime.service';

import { AuditService } from '../../../modules/audit/services/audit.service';

import { AppLoggerService } from '../../logger/logger.service';

interface AssignmentExpiryJobData {
  assignmentId: string;
}

@Processor('dispatch')
export class AssignmentExpiryProcessor extends WorkerHost {
  constructor(
    private readonly dispatchRepository: DispatchRepository,

    private readonly eventBus: EventBusService,

    private readonly realtimeService: RealtimeService,

    private readonly auditService: AuditService,

    private readonly logger: AppLoggerService,
  ) {
    super();
  }

  async process(job: Job<AssignmentExpiryJobData>) {
    if (job.name !== 'assignment-expiry') {
      return;
    }

    const assignment = await this.dispatchRepository.findAssignmentById(
      job.data.assignmentId,
    );

    if (!assignment) {
      return;
    }

    if (assignment.status === AssignmentStatus.PENDING) {
      await this.dispatchRepository.updateAssignmentStatus(
        assignment.id,

        AssignmentStatus.EXPIRED,
      );

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
