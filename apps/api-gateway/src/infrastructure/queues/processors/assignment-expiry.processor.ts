import { Processor, WorkerHost } from '@nestjs/bullmq';

import { Job } from 'bullmq';

import { AssignmentStatus } from '@prisma/client';

import { DispatchRepository } from '../../../modules/dispatch/repositories/dispatch.repository';

import { EventBusService } from '../../../core/events/event-bus.service';

@Processor('dispatch')
export class AssignmentExpiryProcessor extends WorkerHost {
  constructor(
    private readonly dispatchRepository: DispatchRepository,

    private readonly eventBus: EventBusService,
  ) {
    super();
  }

  async process(job: Job) {
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
