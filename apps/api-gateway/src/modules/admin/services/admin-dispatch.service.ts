import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  AuditAction,
  DeliveryPartnerStatus,
  OrderStatus,
  Prisma,
} from '@prisma/client';

import { DeliveryRepository } from '../../delivery/repositories/delivery.repository';

import { DispatchRepository } from '../../dispatch/repositories/dispatch.repository';

import { PresenceService } from '../../presence/services/presence.service';

import { RealtimeService } from '../../realtime/services/realtime.service';

import { QueueService } from '../../../infrastructure/queues/queue.service';

import { AuditService } from '../../audit/services/audit.service';

import { AppLoggerService } from '../../../infrastructure/logger/logger.service';

import { GetAvailableDeliveryPartnersQueryDto } from '../dto/get-available-delivery-partners-query.dto';
import { PaginatedAvailableDeliveryPartnersResponseDto } from '../dto/paginated-available-delivery-partners-response.dto';
import { AvailableDeliveryPartnerResponseDto } from '../dto/available-delivery-partner-response.dto';
import { AssignOrderToPartnerDto } from '../dto/assign-order-to-partner.dto';

const TERMINAL_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.DELIVERED,
  OrderStatus.CANCELLED,
];

type PartnerWithUser = Prisma.DeliveryPartnerGetPayload<{
  include: { user: true };
}>;

/**
 * Backs Phase 9's manual-assignment admin API: `GET /admin/delivery-partners/available` and
 * `POST /admin/orders/:orderId/assign`. Deliberately reuses DeliveryRepository/DispatchRepository
 * directly (both now exported by their modules) rather than duplicating search/pagination/stats
 * logic that already exists — this service is a thin composition layer, not a parallel
 * implementation of dispatch or delivery-partner search.
 */
@Injectable()
export class AdminDispatchService {
  constructor(
    private readonly deliveryRepository: DeliveryRepository,

    private readonly dispatchRepository: DispatchRepository,

    private readonly presenceService: PresenceService,

    private readonly realtimeService: RealtimeService,

    private readonly queueService: QueueService,

    private readonly auditService: AuditService,

    private readonly logger: AppLoggerService,
  ) {}

  async getAvailablePartners(
    query: GetAvailableDeliveryPartnersQueryDto,
  ): Promise<PaginatedAvailableDeliveryPartnersResponseDto> {
    // Unpaginated fetch (mirrors DeliveryService.getAllForAdmin's own established pattern for
    // its `online` filter): partnerId/vehicleType can't be expressed in buildAdminWhere's SQL
    // without modifying that shared, already-completed query builder, so they're applied here
    // in-memory before paginating — acceptable at this table's realistic size.
    const allMatching = (await this.deliveryRepository.findAllMatchingForAdmin({
      search: query.search,

      status: query.status ?? DeliveryPartnerStatus.AVAILABLE,

      verified: true,
    })) as PartnerWithUser[];

    const filtered = allMatching.filter((partner) => {
      if (query.partnerId && partner.id !== query.partnerId) {
        return false;
      }

      if (query.vehicleType && partner.vehicleType !== query.vehicleType) {
        return false;
      }

      return true;
    });

    const total = filtered.length;
    const skip = (query.page - 1) * query.limit;
    const pageItems = filtered.slice(skip, skip + query.limit);

    const [onlineMap, stats, locations] = await Promise.all([
      this.presenceService.isOnlineBatch(
        pageItems.map((partner) => partner.userId),
      ),
      this.deliveryRepository.getDeliveryStatsForUserIds(
        pageItems.map((partner) => partner.userId),
      ),
      this.deliveryRepository.findLocationsByIds(
        pageItems.map((partner) => partner.id),
      ),
    ]);

    const items: AvailableDeliveryPartnerResponseDto[] = pageItems.map(
      (partner) => {
        const currentOrder = stats.currentOrder.get(partner.userId);
        const location = locations.get(partner.id);

        return {
          partnerId: partner.id,
          name: `${partner.user.firstName} ${partner.user.lastName ?? ''}`.trim(),
          phone: partner.user.phone ?? undefined,
          vehicle: partner.vehicleType,
          status: partner.status,
          currentAssignments: currentOrder
            ? [
                {
                  orderId: currentOrder.id,
                  orderNumber: currentOrder.orderNumber,
                  restaurantName: currentOrder.restaurantName,
                },
              ]
            : [],
          online: onlineMap.get(partner.userId) ?? false,
          location: {
            latitude: location?.latitude ?? undefined,
            longitude: location?.longitude ?? undefined,
          },
        };
      },
    );

    return {
      items,
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  /**
   * Manual assignment override — same DeliveryAssignment record shape and PENDING→accept/reject
   * lifecycle as automatic dispatch (DispatchService.assignOrder), so the delivery partner's app
   * handles a manually-assigned offer identically to an automatic one. The admin/DISPATCH_MANAGER
   * only creates the offer; the partner still explicitly accepts or rejects it via the existing
   * `PATCH /dispatch/assignments/:id/accept|reject` endpoints — preserving that already-completed
   * state machine rather than bypassing it.
   */
  async assignOrderToPartner(
    orderId: string,

    dto: AssignOrderToPartnerDto,

    actingUserId: string,
  ) {
    try {
      const order = await this.dispatchRepository.findOrderById(orderId);

      if (!order) {
        throw new NotFoundException('Order not found');
      }

      if (TERMINAL_ORDER_STATUSES.includes(order.status)) {
        throw new BadRequestException(
          `Orders with status ${order.status} cannot be assigned`,
        );
      }

      if (order.deliveryPartnerId) {
        throw new ConflictException(
          'This order already has a delivery partner assigned',
        );
      }

      const activeAssignment =
        await this.dispatchRepository.findActiveAssignmentForOrder(orderId);

      if (activeAssignment) {
        throw new ConflictException(
          'This order already has an active dispatch assignment',
        );
      }

      const partner = await this.dispatchRepository.findPartnerById(
        dto.deliveryPartnerId,
      );

      if (!partner) {
        throw new NotFoundException('Delivery partner not found');
      }

      if (partner.status === DeliveryPartnerStatus.OFFLINE) {
        throw new BadRequestException(
          'This delivery partner is offline and cannot be assigned',
        );
      }

      if (partner.status === DeliveryPartnerStatus.SUSPENDED) {
        throw new ForbiddenException(
          'This delivery partner is suspended and cannot be assigned',
        );
      }

      if (!partner.isVerified) {
        throw new ForbiddenException(
          'This delivery partner has not completed verification',
        );
      }

      const partnerActiveAssignment =
        await this.dispatchRepository.findActiveAssignmentForPartner(
          partner.id,
        );

      if (partnerActiveAssignment) {
        throw new ConflictException(
          'This delivery partner already has an active assignment',
        );
      }

      // Everything above is a fast, friendly pre-check for a good error message — it can still
      // race a concurrent automatic dispatch or another admin's manual assignment for the same
      // order. createAssignmentForOrder is the authoritative, lock-guarded re-check (same method
      // DispatchService.assignOrder uses), so both paths share one real guarantee instead of two
      // separately-race-prone implementations of the same rule.
      const result = await this.dispatchRepository.createAssignmentForOrder({
        orderId,

        deliveryPartnerId: partner.id,

        expiresAt: new Date(Date.now() + 10 * 60 * 1000),

        dispatchableStatuses: [OrderStatus.READY_FOR_PICKUP],
      });

      if (!result.created) {
        const reason =
          result.reason === 'active_assignment_exists'
            ? 'This order already has an active dispatch assignment'
            : result.reason === 'already_has_partner'
              ? 'This order already has a delivery partner assigned'
              : result.reason === 'not_dispatchable'
                ? `Orders with status ${order.status} cannot be assigned`
                : 'Order not found';

        throw new ConflictException(reason);
      }

      const assignment = result.assignment;

      this.logger.log(
        {
          event: 'dispatch_assignment_created',
          orderId,
          assignmentId: assignment.id,
          deliveryPartnerId: partner.id,
          manual: true,
          actingUserId,
        },
        'AdminDispatchService',
      );

      await this.auditService.log(
        actingUserId,
        'DeliveryAssignment',
        assignment.id,
        AuditAction.CREATE,
        null,
        {
          event: 'MANUAL_ASSIGNMENT_CREATED',
          orderId,
          deliveryPartnerId: partner.id,
        },
      );

      this.realtimeService.emitToUser(partner.userId, 'delivery.assignment', {
        assignmentId: assignment.id,

        orderId,
      });

      this.realtimeService.emitToOrder(orderId, 'dispatch.assignment.created', {
        assignmentId: assignment.id,

        orderId,
      });

      this.logger.log(
        {
          event: 'dispatch_notification_sent',
          orderId,
          assignmentId: assignment.id,
          deliveryPartnerUserId: partner.userId,
        },
        'AdminDispatchService',
      );

      await this.queueService.addAssignmentExpiryJob(assignment.id);

      return assignment;
    } catch (error) {
      await this.auditService.log(
        actingUserId,
        'DeliveryAssignment',
        null,
        AuditAction.CREATE,
        null,
        {
          event: 'MANUAL_ASSIGNMENT_FAILED',
          orderId,
          deliveryPartnerId: dto.deliveryPartnerId,
          reason: error instanceof Error ? error.message : 'Unknown error',
        },
      );

      this.logger.error(
        {
          event: 'dispatch_assignment_failed',
          reason: error instanceof Error ? error.message : 'Unknown error',
          orderId,
          deliveryPartnerId: dto.deliveryPartnerId,
          manual: true,
        },
        error instanceof Error ? error.stack : undefined,
        'AdminDispatchService',
      );

      throw error;
    }
  }
}
