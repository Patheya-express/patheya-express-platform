import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';

import { AssignmentStatus } from '@prisma/client';

import { DispatchRepository } from '../repositories/dispatch.repository';

import { RealtimeService } from '../../realtime/services/realtime.service';

import { QueueService } from 'src/infrastructure/queues/queue.service';

import { PresenceService } from '../../presence/services/presence.service';
import { EventBusService } from '../../../core/events/event-bus.service';

import { DeliveryPartnerAssignedEvent } from '../events/delivery-partner-assigned.event';

@Injectable()
export class DispatchService {
  constructor(
    private readonly dispatchRepository: DispatchRepository,

    private readonly realtimeService: RealtimeService,
    private readonly queueService: QueueService,
    private readonly presenceService: PresenceService,
    private readonly eventBus: EventBusService,
  ) {}

  async assignOrder(orderId: string) {
    const activeAssignment =
      await this.dispatchRepository.findActiveAssignmentForOrder(orderId);

    if (activeAssignment) {
      return activeAssignment;
    }

    const previousAssignments =
      await this.dispatchRepository.findAssignmentsForOrder(orderId);

    const attemptedPartnerIds = previousAssignments.map(
      (assignment) => assignment.deliveryPartnerId,
    );

    const partners = await this.dispatchRepository.findAvailablePartners();

    const onlinePartners: any[] = [];

    for (const partner of partners) {
      const isOnline = await this.presenceService.isOnline(partner.userId);

      if (isOnline && !attemptedPartnerIds.includes(partner.id)) {
        onlinePartners.push(partner);
      }
    }

    if (!onlinePartners.length) {
      throw new NotFoundException('No delivery partners available');
    }

    const partner = onlinePartners[0];

    const assignment = await this.dispatchRepository.createAssignment({
      orderId,

      deliveryPartnerId: partner.id,

      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });

    this.realtimeService.emitToUser(
      partner.userId,

      'delivery.assignment',

      {
        assignmentId: assignment.id,

        orderId,
      },
    );

    await this.queueService.addAssignmentExpiryJob(assignment.id);

    const order = await this.dispatchRepository.findOrderById(orderId);

    if (order) {
      await this.eventBus.publish(
        'delivery.partner.assigned',

        new DeliveryPartnerAssignedEvent(
          order.id,

          order.customerId,

          partner.userId,
        ),
      );
    }

    return assignment;
  }

  async acceptAssignment(
    assignmentId: string,

    userId: string,
  ) {
    const partner = await this.dispatchRepository.findPartnerByUserId(userId);

    if (!partner) {
      throw new NotFoundException('Delivery partner not found');
    }

    const assignment =
      await this.dispatchRepository.findAssignmentById(assignmentId);

    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }

    if (assignment.deliveryPartnerId !== partner.id) {
      throw new ForbiddenException('Assignment does not belong to you');
    }

    if (assignment.status !== AssignmentStatus.PENDING) {
      throw new BadRequestException('Only pending assignments can be accepted');
    }

    await this.dispatchRepository.updateAssignmentStatus(
      assignmentId,

      AssignmentStatus.ACCEPTED,
    );

    await this.dispatchRepository.assignOrderToPartner(
      assignment.orderId,

      partner.userId,
    );

    return {
      success: true,
    };
  }

  async rejectAssignment(
    assignmentId: string,

    userId: string,
  ) {
    const partner = await this.dispatchRepository.findPartnerByUserId(userId);

    if (!partner) {
      throw new NotFoundException('Delivery partner not found');
    }

    const assignment =
      await this.dispatchRepository.findAssignmentById(assignmentId);

    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }

    if (assignment.deliveryPartnerId !== partner.id) {
      throw new ForbiddenException('Assignment does not belong to you');
    }

    if (assignment.status !== AssignmentStatus.PENDING) {
      throw new BadRequestException('Only pending assignments can be rejected');
    }

    await this.dispatchRepository.updateAssignmentStatus(
      assignmentId,

      AssignmentStatus.REJECTED,
    );

    await this.eventBus.publish(
      'dispatch.assignment.rejected',

      {
        orderId: assignment.orderId,

        assignmentId: assignment.id,
      },
    );

    return {
      success: true,
    };
  }

  async getAssignments(userId: string) {
    const partner = await this.dispatchRepository.findPartnerByUserId(userId);

    if (!partner) {
      throw new NotFoundException('Delivery partner not found');
    }

    const assignments = await this.dispatchRepository.findPartnerAssignments(
      partner.id,
    );

    return assignments.map((assignment: any) => ({
      ...assignment,

      order: assignment.order && {
        ...assignment.order,

        items: assignment.order.items.map((item: any) => ({
          ...item,

          menuItemName: item.menuItem?.name,

          menuItem: undefined,
        })),
      },
    }));
  }
}
