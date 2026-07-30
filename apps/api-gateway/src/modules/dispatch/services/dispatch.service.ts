import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';

import {
  AssignmentStatus,
  AuditAction,
  DeliveryPartnerStatus,
  OrderStatus,
} from '@prisma/client';

import { DispatchRepository } from '../repositories/dispatch.repository';

import { RealtimeService } from '../../realtime/services/realtime.service';

import { QueueService } from 'src/infrastructure/queues/queue.service';

import { PresenceService } from '../../presence/services/presence.service';
import { EventBusService } from '../../../core/events/event-bus.service';
import { AppLoggerService } from '../../../infrastructure/logger/logger.service';
import { AuditService } from '../../audit/services/audit.service';

import { DeliveryPartnerAssignedEvent } from '../events/delivery-partner-assigned.event';

/** Order statuses a fresh dispatch assignment may still be created for — anything else means
 *  the order moved on (or was cancelled) since `order.ready` fired, so assignment is a no-op,
 *  not an error (a stale/duplicate event re-trigger is expected, e.g. a delayed retry queued
 *  before a cancellation landed). */
const DISPATCHABLE_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.READY_FOR_PICKUP,
];

@Injectable()
export class DispatchService {
  constructor(
    private readonly dispatchRepository: DispatchRepository,

    private readonly realtimeService: RealtimeService,
    private readonly queueService: QueueService,
    private readonly presenceService: PresenceService,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Automatic assignment — invoked by DispatchListener on `order.ready`,
   * `dispatch.assignment.rejected`, and `dispatch.assignment.expired`. Idempotent and safe to
   * call repeatedly for the same order (Phase 4 validation below): an order that's already
   * actively assigned, already has a delivery partner, doesn't exist, or is no longer in a
   * dispatchable status is a logged no-op, never a duplicate assignment.
   */
  async assignOrder(orderId: string) {
    const order = await this.dispatchRepository.findOrderById(orderId);

    if (!order) {
      this.logger.error(
        {
          event: 'dispatch_assignment_failed',
          reason: 'order_not_found',
          orderId,
        },
        undefined,
        'DispatchService',
      );

      return null;
    }

    if (order.deliveryPartnerId) {
      this.logger.log(
        {
          event: 'dispatch_assignment_skipped',
          reason: 'order_already_has_delivery_partner',
          orderId,
          deliveryPartnerId: order.deliveryPartnerId,
        },
        'DispatchService',
      );

      return null;
    }

    if (!DISPATCHABLE_ORDER_STATUSES.includes(order.status)) {
      this.logger.log(
        {
          event: 'dispatch_assignment_skipped',
          reason: 'order_not_in_dispatchable_status',
          orderId,
          status: order.status,
        },
        'DispatchService',
      );

      return null;
    }

    const activeAssignment =
      await this.dispatchRepository.findActiveAssignmentForOrder(orderId);

    if (activeAssignment) {
      this.logger.log(
        {
          event: 'dispatch_assignment_skipped',
          reason: 'active_assignment_already_exists',
          orderId,
          assignmentId: activeAssignment.id,
        },
        'DispatchService',
      );

      return activeAssignment;
    }

    const previousAssignments =
      await this.dispatchRepository.findAssignmentsForOrder(orderId);

    const attemptedPartnerIds = previousAssignments.map(
      (assignment) => assignment.deliveryPartnerId,
    );

    const partners = await this.dispatchRepository.findAvailablePartners();

    this.logger.log(
      {
        event: 'eligible_delivery_partners_found',
        orderId,
        eligible_partner_count: partners.length,
      },
      'DispatchService',
    );

    // Batched via MGET (production-validation performance finding) — one Redis round trip for
    // every candidate partner instead of one sequential round trip per partner.
    const onlineMap = await this.presenceService.isOnlineBatch(
      partners.map((partner) => partner.userId),
    );

    const activePartnerAssignments =
      await this.dispatchRepository.findPartnerIdsWithActiveAssignment(
        partners.map((partner) => partner.id),
      );

    const onlinePartners = partners.filter(
      (partner) =>
        onlineMap.get(partner.userId) === true &&
        !attemptedPartnerIds.includes(partner.id) &&
        !activePartnerAssignments.has(partner.id),
    );

    this.logger.log(
      {
        event: 'eligible_delivery_partners_filtered',
        orderId,
        eligible_partner_count: partners.length,
        filtered_partner_count: onlinePartners.length,
      },
      'DispatchService',
    );

    if (!onlinePartners.length) {
      this.logger.error(
        {
          event: 'dispatch_assignment_failed',
          reason: 'no_delivery_partners_available',
          orderId,
          eligible_partner_count: partners.length,
        },
        undefined,
        'DispatchService',
      );

      throw new NotFoundException('No delivery partners available');
    }

    const partner = onlinePartners[0];

    const result = await this.dispatchRepository.createAssignmentForOrder({
      orderId,

      deliveryPartnerId: partner.id,

      expiresAt: new Date(Date.now() + 10 * 60 * 1000),

      dispatchableStatuses: DISPATCHABLE_ORDER_STATUSES,
    });

    if (!result.created) {
      // Lost the race — another concurrent assignOrder() call (duplicate order.ready delivery,
      // a simultaneous redispatch trigger, or a manual admin assignment) already claimed this
      // order first. Same idempotent-no-op contract as the pre-existing early-exit checks above.
      this.logger.log(
        {
          event: 'dispatch_assignment_skipped',
          reason: result.reason,
          orderId,
        },
        'DispatchService',
      );

      return null;
    }

    const assignment = result.assignment;

    this.logger.log(
      {
        event: 'dispatch_assignment_created',
        orderId,
        assignmentId: assignment.id,
        deliveryPartnerId: partner.id,
      },
      'DispatchService',
    );

    this.logger.log(
      {
        event: 'dispatch_assignment_saved',
        orderId,
        assignmentId: assignment.id,
      },
      'DispatchService',
    );

    await this.auditService.log(
      null,
      'DeliveryAssignment',
      assignment.id,
      AuditAction.CREATE,
      null,
      {
        event: 'AUTO_ASSIGNMENT_CREATED',
        orderId,
        deliveryPartnerId: partner.id,
      },
    );

    this.realtimeService.emitToUser(
      partner.userId,

      'delivery.assignment',

      {
        assignmentId: assignment.id,

        orderId,
      },
    );

    this.logger.log(
      {
        event: 'dispatch_notification_sent',
        orderId,
        assignmentId: assignment.id,
        deliveryPartnerUserId: partner.userId,
      },
      'DispatchService',
    );

    await this.queueService.addAssignmentExpiryJob(assignment.id);

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

    // EDPH-1 online-protection, defense-in-depth: assignments are only ever created for
    // partners findAvailablePartners() already filtered to isVerified+AVAILABLE, but re-check
    // here too so a partner who loses verification/gets suspended mid-assignment can't accept.
    if (
      !partner.isVerified ||
      partner.status === DeliveryPartnerStatus.SUSPENDED
    ) {
      throw new ForbiddenException(
        'Your account is not eligible to accept assignments',
      );
    }

    // The authoritative check: assignment.status above is a pre-fetched snapshot, not proof the
    // row is still PENDING right now — a concurrent accept, reject, or the expiry processor may
    // have already claimed it. acceptAssignmentAtomic re-verifies and claims the assignment,
    // the partner, and the order together, atomically; nothing about "am I allowed to accept"
    // is trusted from the read above.
    const result = await this.dispatchRepository.acceptAssignmentAtomic({
      assignmentId,

      deliveryPartnerId: partner.id,

      deliveryPartnerUserId: partner.userId,

      orderId: assignment.orderId,
    });

    if (!result.accepted) {
      if (result.reason === 'assignment_not_pending') {
        throw new BadRequestException(
          'Only pending assignments can be accepted',
        );
      }

      if (result.reason === 'partner_not_available') {
        throw new ConflictException(
          'You are no longer available to accept this assignment',
        );
      }

      throw new ConflictException(
        'This order already has a delivery partner assigned',
      );
    }

    this.logger.log(
      {
        event: 'dispatch_assignment_accepted',
        assignmentId,
        orderId: assignment.orderId,
        deliveryPartnerId: partner.id,
      },
      'DispatchService',
    );

    await this.auditService.log(
      userId,
      'DeliveryAssignment',
      assignmentId,
      AuditAction.STATUS_CHANGE,
      { status: AssignmentStatus.PENDING },
      { event: 'ASSIGNMENT_ACCEPTED', status: AssignmentStatus.ACCEPTED },
    );

    this.realtimeService.emitToOrder(
      assignment.orderId,
      'dispatch.assignment.accepted',
      {
        assignmentId,
        orderId: assignment.orderId,
      },
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

    // Same TOCTOU close as acceptAssignment: the row's real status is claimed atomically here,
    // not trusted from the read above (a concurrent accept or the expiry processor may have
    // already claimed it).
    const claim = await this.dispatchRepository.claimAssignmentTransition(
      assignmentId,

      [AssignmentStatus.PENDING],

      AssignmentStatus.REJECTED,
    );

    if (claim.count === 0) {
      throw new BadRequestException('Only pending assignments can be rejected');
    }

    this.logger.log(
      {
        event: 'dispatch_assignment_rejected',
        assignmentId,
        orderId: assignment.orderId,
        deliveryPartnerId: partner.id,
      },
      'DispatchService',
    );

    await this.auditService.log(
      userId,
      'DeliveryAssignment',
      assignmentId,
      AuditAction.STATUS_CHANGE,
      { status: AssignmentStatus.PENDING },
      { event: 'ASSIGNMENT_REJECTED', status: AssignmentStatus.REJECTED },
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

  /** `status` is additive/optional — omitted, this returns exactly what it always has (every
   *  assignment for the partner, newest first); passed, it narrows to that one AssignmentStatus.
   *  No existing caller (DispatchController's current route) passes it, so behavior for them is
   *  unchanged. */
  async getAssignments(userId: string, status?: AssignmentStatus) {
    const partner = await this.dispatchRepository.findPartnerByUserId(userId);

    if (!partner) {
      throw new NotFoundException('Delivery partner not found');
    }

    const assignments = await this.dispatchRepository.findPartnerAssignments(
      partner.id,

      status,
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
