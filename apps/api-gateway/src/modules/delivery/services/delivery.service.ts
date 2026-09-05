import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  ConflictException,
  NotFoundException,
  Inject,
  forwardRef,
} from '@nestjs/common';

import {
  AuditAction,
  DeliveryPartnerStatus,
  OrderStatus,
  UserStatus,
} from '@prisma/client';

import { DeliveryRepository } from '../repositories/delivery.repository';

import { CreateDeliveryPartnerDto } from '../dto/create-delivery-partner.dto';

import { UpdateDeliveryStatusDto } from '../dto/update-delivery-status.dto';
import { GetAdminDeliveryPartnersQueryDto } from '../dto/get-admin-delivery-partners-query.dto';
import { PaginatedAdminDeliveryPartnersResponseDto } from '../dto/paginated-admin-delivery-partners-response.dto';
import { AdminDeliveryPartnerResponseDto } from '../dto/admin-delivery-partner-response.dto';

import { PresenceService } from '../../presence/services/presence.service';
import { UsersService } from '../../users/services/users.service';
import { OrdersService } from '../../orders/services/orders.service';
import { EventBusService } from '../../../core/events/event-bus.service';
import { AuthenticatedUser } from '../../../shared/authorization/order-access.util';
import { AppLoggerService } from '../../../infrastructure/logger/logger.service';
import { AuditService } from '../../audit/services/audit.service';

/** Every DeliveryPartnerStatus suspendPartner() may legally act on — anything not already
 *  SUSPENDED, matching the pre-existing JS check this claim replaces exactly. */
const NON_SUSPENDED_PARTNER_STATUSES: DeliveryPartnerStatus[] = [
  DeliveryPartnerStatus.OFFLINE,
  DeliveryPartnerStatus.AVAILABLE,
  DeliveryPartnerStatus.ON_DELIVERY,
];

/**
 * Flattens the raw Prisma include shape (user as a full User row) into the documented
 * AdminDeliveryPartnerResponseDto shape — this is what keeps the user's passwordHash out of
 * admin API responses.
 */
function toAdminDeliveryPartner(
  partner: any,
  online: boolean,
  stats: {
    completedDeliveries: Map<string, number>;
    todaysDeliveries: Map<string, number>;
    estimatedFeesToday: Map<string, number>;
    currentOrder: Map<
      string,
      {
        id: string;
        orderNumber: string;
        status: OrderStatus;
        restaurantName: string;
      }
    >;
  },
): AdminDeliveryPartnerResponseDto {
  return {
    id: partner.id,
    user: {
      id: partner.user.id,
      firstName: partner.user.firstName,
      lastName: partner.user.lastName,
      email: partner.user.email,
      phone: partner.user.phone,
      status: partner.user.status,
    },
    vehicleType: partner.vehicleType,
    vehicleNumber: partner.vehicleNumber,
    licenseNumber: partner.licenseNumber,
    status: partner.status,
    isVerified: partner.isVerified,
    online,
    currentOrder: stats.currentOrder.get(partner.userId),
    completedDeliveries: stats.completedDeliveries.get(partner.userId) ?? 0,
    todaysDeliveries: stats.todaysDeliveries.get(partner.userId) ?? 0,
    estimatedFeesToday: stats.estimatedFeesToday.get(partner.userId) ?? 0,
    createdAt: partner.createdAt,
    updatedAt: partner.updatedAt,
  };
}

@Injectable()
export class DeliveryService {
  constructor(
    private readonly deliveryRepository: DeliveryRepository,
    private readonly presenceService: PresenceService,
    private readonly usersService: UsersService,
    @Inject(forwardRef(() => OrdersService))
    private readonly ordersService: OrdersService,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
    private readonly auditService: AuditService,
  ) {}

  async onboardPartner(
    userId: string,

    dto: CreateDeliveryPartnerDto,
  ) {
    const existingPartner =
      await this.deliveryRepository.findPartnerByUserId(userId);

    if (existingPartner) {
      throw new ConflictException('Delivery partner already exists');
    }

    const partner = await this.deliveryRepository.createDeliveryPartner({
      userId,

      vehicleType: dto.vehicleType,

      vehicleNumber: dto.vehicleNumber,

      licenseNumber: dto.licenseNumber,
    });

    await this.eventBus.publish('delivery.created', {
      deliveryPartnerId: partner.id,
      userId,
    });

    return partner;
  }

  async getMe(userId: string) {
    const partner = await this.deliveryRepository.findPartnerByUserId(userId);

    if (!partner) {
      throw new NotFoundException('Delivery partner not found');
    }

    return partner;
  }

  /**
   * EDPH-1 online-protection gate. A delivery partner must never go online/receive orders until
   * onboarding is complete, verification is APPROVED, and the account is active — enforced here
   * (goAvailable), in PresenceController.markOnline (the other path a partner can appear
   * "online" from), and defense-in-depth in DispatchService.acceptAssignment. Dispatch matching
   * itself already filters on isVerified — this is what keeps that boolean trustworthy.
   */
  async assertOnlineEligible(userId: string): Promise<void> {
    const partner =
      await this.deliveryRepository.findPartnerWithUserByUserId(userId);

    if (!partner) {
      throw new NotFoundException('Delivery partner not found');
    }

    if (!partner.isVerified) {
      throw new ForbiddenException(
        'Complete onboarding and verification before going online',
      );
    }

    if (partner.status === DeliveryPartnerStatus.SUSPENDED) {
      throw new ForbiddenException(
        'Your delivery partner account is suspended',
      );
    }

    if (partner.user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('Your account is not active');
    }
  }

  /**
   * Also marks live Redis presence (`PresenceService.markOnline`) — this used to only flip the
   * DB `status` column, leaving a partner who called *only* this endpoint invisible to
   * `DispatchService.assignOrder()`'s presence check (`PresenceService.isOnline`), which requires
   * both signals. That gap meant automatic dispatch silently found zero eligible partners for
   * any partner who never separately called `POST /presence/online` — the root cause of dispatch
   * assignments never being created. A single "go available" action now satisfies both checks;
   * the standalone `/presence/online` endpoint still exists unchanged for heartbeat-style re-pings.
   */
  async goAvailable(userId: string) {
    await this.assertOnlineEligible(userId);

    const partner = await this.deliveryRepository.updatePartnerStatus(
      userId,

      DeliveryPartnerStatus.AVAILABLE,
    );

    await this.presenceService.markOnline(userId);

    this.logger.log(
      { event: 'delivery_partner_went_available', userId },
      'DeliveryService',
    );

    return partner;
  }

  /** Also clears live Redis presence — the counterpart to goAvailable()'s fix above, so a
   *  partner who goes offline via this single action is immediately excluded from dispatch
   *  rather than remaining "present" until their presence TTL happens to expire. */
  async goOffline(userId: string) {
    const partner = await this.deliveryRepository.updatePartnerStatus(
      userId,

      DeliveryPartnerStatus.OFFLINE,
    );

    await this.presenceService.markOffline(userId);

    this.logger.log(
      { event: 'delivery_partner_went_offline', userId },
      'DeliveryService',
    );

    return partner;
  }

  async getAssignedOrders(userId: string) {
    return this.deliveryRepository.getAssignedOrders(userId);
  }

  /** Called by OrdersService whenever an order carrying an assigned delivery partner reaches a
   *  terminal state (DELIVERED, or an admin cancel/force-complete of an order already out for
   *  delivery) — the other end of the ON_DELIVERY transition acceptAssignmentAtomic makes on
   *  accept. Without this, a partner who accepted an order would remain ON_DELIVERY (and
   *  therefore invisible to findAvailablePartners) forever after finishing it.
   *
   *  `orderId` also closes out that order's DeliveryAssignment row to COMPLETED — see
   *  DeliveryRepository.releaseFromDelivery for why that's required, not just the partner-status
   *  flip. Optional to keep this call backward compatible with any caller that only has a userId. */
  async releasePartnerFromDelivery(
    userId: string,
    orderId?: string,
  ): Promise<void> {
    const result = await this.deliveryRepository.releaseFromDelivery(
      userId,
      orderId,
    );

    if (result.count > 0) {
      this.logger.log(
        { event: 'delivery_partner_released_from_delivery', userId },
        'DeliveryService',
      );
    }
  }

  /**
   * Delegates to OrdersService.updateOrderStatus — the single source of truth for order-status
   * transitions (validation, OrderStatusHistory, domain events, and realtime push). This used
   * to update the order directly with none of that side-effect wiring; it no longer does.
   */
  async updateDeliveryStatus(
    orderId: string,

    user: AuthenticatedUser,

    dto: UpdateDeliveryStatusDto,
  ) {
    this.logger.log(
      {
        event: 'delivery_status_update_requested',
        orderId,
        targetStatus: dto.status,
        userId: user.userId,
      },
      'DeliveryService',
    );

    return this.ordersService.updateOrderStatus(orderId, dto, user);
  }

  async countActivePartners(): Promise<number> {
    return this.deliveryRepository.countActivePartners();
  }

  /** Unlike getMe(), returns null instead of throwing — used by other modules to validate a candidate user ID. */
  async findPartnerByUserId(userId: string) {
    return this.deliveryRepository.findPartnerByUserId(userId);
  }

  async getAllForAdmin(
    query: GetAdminDeliveryPartnersQueryDto,
  ): Promise<PaginatedAdminDeliveryPartnersResponseDto> {
    const filters = {
      search: query.search,
      status: query.status,
      availability:
        query.availability === undefined
          ? undefined
          : query.availability === 'true',
      verified: query.verified,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
    };

    let pageItems: any[];
    let total: number;
    let onlineMap: Map<string, boolean>;

    if (query.online === undefined) {
      const skip = (query.page - 1) * query.limit;
      const result = await this.deliveryRepository.findAllForAdmin({
        ...filters,
        skip,
        take: query.limit,
      });
      pageItems = result.items;
      total = result.total;
      onlineMap = await this.buildOnlineMap(
        pageItems.map((partner) => partner.userId),
      );
    } else {
      const onlineFilter = query.online === 'true';
      const allMatching =
        await this.deliveryRepository.findAllMatchingForAdmin(filters);
      const fullOnlineMap = await this.buildOnlineMap(
        allMatching.map((partner) => partner.userId),
      );
      const filtered = allMatching.filter(
        (partner) =>
          (fullOnlineMap.get(partner.userId) ?? false) === onlineFilter,
      );

      total = filtered.length;
      const skip = (query.page - 1) * query.limit;
      pageItems = filtered.slice(skip, skip + query.limit);
      onlineMap = fullOnlineMap;
    }

    const stats = await this.deliveryRepository.getDeliveryStatsForUserIds(
      pageItems.map((partner) => partner.userId),
    );

    return {
      items: pageItems.map((partner) =>
        toAdminDeliveryPartner(
          partner,
          onlineMap.get(partner.userId) ?? false,
          stats,
        ),
      ),

      total,

      page: query.page,

      limit: query.limit,

      totalPages: Math.ceil(total / query.limit),
    };
  }

  // Production Readiness Stage C: previously N sequential Redis GETs (one per partner, via
  // Promise.all(...isOnline...)) — now a single MGET via the same isOnlineBatch helper
  // DispatchService.assignOrder already uses for this exact reason.
  private async buildOnlineMap(
    userIds: string[],
  ): Promise<Map<string, boolean>> {
    return this.presenceService.isOnlineBatch(userIds);
  }

  private async findAdminTarget(deliveryPartnerId: string) {
    const partner = await this.deliveryRepository.findById(deliveryPartnerId);

    if (!partner) {
      throw new NotFoundException('Delivery partner not found');
    }

    return partner;
  }

  /**
   * Approve/Reject operate solely on the isVerified boolean — there is no separate
   * pending/rejected state to validate against (see this field's own schema doc comment — this
   * legacy pair is kept for backward compatibility; DeliveryVerificationService's stage-based
   * flow is the primary workflow). Sprint 1.9: made exactly-once by claiming the *current* value
   * as the precondition — approve requires isVerified still false (closes "partner cannot become
   * APPROVED twice"), reject requires isVerified still true (revoking an approval that's actually
   * in effect) — rather than the old unconditional flip, which let two concurrent admin actions
   * silently overwrite each other with no record of who actually won.
   */
  async approvePartner(deliveryPartnerId: string, adminUserId: string) {
    await this.findAdminTarget(deliveryPartnerId);

    const claim = await this.deliveryRepository.claimVerification(
      deliveryPartnerId,

      false,

      true,
    );

    if (claim.count === 0) {
      throw new ConflictException('Delivery partner is already approved');
    }

    await this.auditService.log(
      adminUserId,
      'DeliveryPartner',
      deliveryPartnerId,
      AuditAction.APPROVE,
      { isVerified: false },
      { isVerified: true },
    );

    return this.findAdminTarget(deliveryPartnerId);
  }

  async rejectPartner(deliveryPartnerId: string, adminUserId: string) {
    await this.findAdminTarget(deliveryPartnerId);

    const claim = await this.deliveryRepository.claimVerification(
      deliveryPartnerId,

      true,

      false,
    );

    if (claim.count === 0) {
      throw new ConflictException('Delivery partner is not currently approved');
    }

    await this.auditService.log(
      adminUserId,
      'DeliveryPartner',
      deliveryPartnerId,
      AuditAction.REJECT,
      { isVerified: true },
      { isVerified: false },
    );

    return this.findAdminTarget(deliveryPartnerId);
  }

  async suspendPartner(deliveryPartnerId: string, adminUserId: string) {
    const partner = await this.findAdminTarget(deliveryPartnerId);

    if (partner.status === DeliveryPartnerStatus.SUSPENDED) {
      throw new BadRequestException('Delivery partner is already suspended');
    }

    const claim = await this.deliveryRepository.claimPartnerStatus(
      deliveryPartnerId,

      NON_SUSPENDED_PARTNER_STATUSES,

      DeliveryPartnerStatus.SUSPENDED,
    );

    if (claim.count === 0) {
      throw new ConflictException(
        'Delivery partner is no longer eligible for suspension — a concurrent admin action already changed its status',
      );
    }

    await this.auditService.log(
      adminUserId,
      'DeliveryPartner',
      deliveryPartnerId,
      AuditAction.STATUS_CHANGE,
      { status: partner.status },
      { status: DeliveryPartnerStatus.SUSPENDED },
    );

    return this.findAdminTarget(deliveryPartnerId);
  }

  async restorePartner(deliveryPartnerId: string, adminUserId: string) {
    const partner = await this.findAdminTarget(deliveryPartnerId);

    if (partner.status !== DeliveryPartnerStatus.SUSPENDED) {
      throw new BadRequestException('Only suspended partners can be restored');
    }

    const claim = await this.deliveryRepository.claimPartnerStatus(
      deliveryPartnerId,

      [DeliveryPartnerStatus.SUSPENDED],

      DeliveryPartnerStatus.OFFLINE,
    );

    if (claim.count === 0) {
      throw new ConflictException(
        'Delivery partner is no longer suspended — a concurrent admin action already changed its status',
      );
    }

    await this.auditService.log(
      adminUserId,
      'DeliveryPartner',
      deliveryPartnerId,
      AuditAction.STATUS_CHANGE,
      { status: DeliveryPartnerStatus.SUSPENDED },
      { status: DeliveryPartnerStatus.OFFLINE },
    );

    return this.findAdminTarget(deliveryPartnerId);
  }

  /** Admin-scoped variant of goOffline() — targets an arbitrary partner instead of the caller. */
  async forceOffline(deliveryPartnerId: string, adminUserId: string) {
    const partner = await this.findAdminTarget(deliveryPartnerId);

    if (
      partner.status !== DeliveryPartnerStatus.AVAILABLE &&
      partner.status !== DeliveryPartnerStatus.ON_DELIVERY
    ) {
      throw new BadRequestException('Delivery partner is not currently online');
    }

    const claim = await this.deliveryRepository.claimPartnerStatus(
      deliveryPartnerId,

      [DeliveryPartnerStatus.AVAILABLE, DeliveryPartnerStatus.ON_DELIVERY],

      DeliveryPartnerStatus.OFFLINE,
    );

    if (claim.count === 0) {
      throw new ConflictException(
        'Delivery partner is no longer online — a concurrent action already changed its status',
      );
    }

    await this.auditService.log(
      adminUserId,
      'DeliveryPartner',
      deliveryPartnerId,
      AuditAction.STATUS_CHANGE,
      { status: partner.status },
      { status: DeliveryPartnerStatus.OFFLINE },
    );

    return this.findAdminTarget(deliveryPartnerId);
  }

  /** Account-level block, distinct from suspendPartner()'s operational-level suspension — delegates to UsersService, no duplicated status-transition logic. */
  async blockPartner(deliveryPartnerId: string, actingUserId: string) {
    const partner = await this.findAdminTarget(deliveryPartnerId);

    return this.usersService.blockUser(partner.userId, actingUserId);
  }

  async unblockPartner(deliveryPartnerId: string, actingUserId: string) {
    const partner = await this.findAdminTarget(deliveryPartnerId);

    return this.usersService.restoreUser(partner.userId, actingUserId);
  }
}
