import {
  BadRequestException,
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import { DeliveryPartnerStatus, OrderStatus } from '@prisma/client';

import { DeliveryRepository } from '../repositories/delivery.repository';

import { CreateDeliveryPartnerDto } from '../dto/create-delivery-partner.dto';

import { UpdateDeliveryStatusDto } from '../dto/update-delivery-status.dto';
import { GetAdminDeliveryPartnersQueryDto } from '../dto/get-admin-delivery-partners-query.dto';
import { PaginatedAdminDeliveryPartnersResponseDto } from '../dto/paginated-admin-delivery-partners-response.dto';
import { AdminDeliveryPartnerResponseDto } from '../dto/admin-delivery-partner-response.dto';

import { PresenceService } from '../../presence/services/presence.service';
import { UsersService } from '../../users/services/users.service';

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
    currentOrder: Map<string, { id: string; orderNumber: string; status: OrderStatus; restaurantName: string }>;
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

    return this.deliveryRepository.createDeliveryPartner({
      userId,

      vehicleType: dto.vehicleType,

      vehicleNumber: dto.vehicleNumber,

      licenseNumber: dto.licenseNumber,
    });
  }

  async getMe(userId: string) {
    const partner = await this.deliveryRepository.findPartnerByUserId(userId);

    if (!partner) {
      throw new NotFoundException('Delivery partner not found');
    }

    return partner;
  }

  async goAvailable(userId: string) {
    return this.deliveryRepository.updatePartnerStatus(
      userId,

      DeliveryPartnerStatus.AVAILABLE,
    );
  }

  async goOffline(userId: string) {
    return this.deliveryRepository.updatePartnerStatus(
      userId,

      DeliveryPartnerStatus.OFFLINE,
    );
  }

  async getAssignedOrders(userId: string) {
    return this.deliveryRepository.getAssignedOrders(userId);
  }

  async updateDeliveryStatus(
    orderId: string,

    userId: string,

    dto: UpdateDeliveryStatusDto,
  ) {
    const order = await this.deliveryRepository.findOrderByIdForPartner(
      orderId,

      userId,
    );

    if (!order) {
      throw new NotFoundException('Order not assigned to you');
    }

    const allowedTransitions = {
      [OrderStatus.READY_FOR_PICKUP]: [OrderStatus.OUT_FOR_DELIVERY],

      [OrderStatus.OUT_FOR_DELIVERY]: [OrderStatus.DELIVERED],

      [OrderStatus.DELIVERED]: [],
    };

    const validStatuses = allowedTransitions[order.status] || [];

    if (!validStatuses.includes(dto.status)) {
      throw new ConflictException(
        `Invalid status transition from ${order.status} to ${dto.status}`,
      );
    }

    return this.deliveryRepository.updateOrderStatus(
      orderId,

      dto.status,
    );
  }

  async countActivePartners(): Promise<number> {
    return this.deliveryRepository.countActivePartners();
  }

  /** Unlike getMe(), returns null instead of throwing — used by other modules to validate a candidate user ID. */
  async findPartnerByUserId(userId: string) {
    return this.deliveryRepository.findPartnerByUserId(userId);
  }

  async getAllForAdmin(query: GetAdminDeliveryPartnersQueryDto): Promise<PaginatedAdminDeliveryPartnersResponseDto> {
    const filters = {
      search: query.search,
      status: query.status,
      availability: query.availability === undefined ? undefined : query.availability === 'true',
      verified: query.verified,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
    };

    let pageItems: any[];
    let total: number;
    let onlineMap: Map<string, boolean>;

    if (query.online === undefined) {
      const skip = (query.page - 1) * query.limit;
      const result = await this.deliveryRepository.findAllForAdmin({ ...filters, skip, take: query.limit });
      pageItems = result.items;
      total = result.total;
      onlineMap = await this.buildOnlineMap(pageItems.map((partner) => partner.userId));
    } else {
      const onlineFilter = query.online === 'true';
      const allMatching = await this.deliveryRepository.findAllMatchingForAdmin(filters);
      const fullOnlineMap = await this.buildOnlineMap(allMatching.map((partner) => partner.userId));
      const filtered = allMatching.filter((partner) => (fullOnlineMap.get(partner.userId) ?? false) === onlineFilter);

      total = filtered.length;
      const skip = (query.page - 1) * query.limit;
      pageItems = filtered.slice(skip, skip + query.limit);
      onlineMap = fullOnlineMap;
    }

    const stats = await this.deliveryRepository.getDeliveryStatsForUserIds(pageItems.map((partner) => partner.userId));

    return {
      items: pageItems.map((partner) => toAdminDeliveryPartner(partner, onlineMap.get(partner.userId) ?? false, stats)),

      total,

      page: query.page,

      limit: query.limit,

      totalPages: Math.ceil(total / query.limit),
    };
  }

  private async buildOnlineMap(userIds: string[]): Promise<Map<string, boolean>> {
    const entries = await Promise.all(
      userIds.map(async (userId) => [userId, await this.presenceService.isOnline(userId)] as const),
    );

    return new Map(entries);
  }

  private async findAdminTarget(deliveryPartnerId: string) {
    const partner = await this.deliveryRepository.findById(deliveryPartnerId);

    if (!partner) {
      throw new NotFoundException('Delivery partner not found');
    }

    return partner;
  }

  /** Approve/Reject operate solely on the isVerified boolean — there is no separate pending/rejected state to validate against. */
  async approvePartner(deliveryPartnerId: string) {
    await this.findAdminTarget(deliveryPartnerId);

    return this.deliveryRepository.updateVerification(deliveryPartnerId, true);
  }

  async rejectPartner(deliveryPartnerId: string) {
    await this.findAdminTarget(deliveryPartnerId);

    return this.deliveryRepository.updateVerification(deliveryPartnerId, false);
  }

  async suspendPartner(deliveryPartnerId: string) {
    const partner = await this.findAdminTarget(deliveryPartnerId);

    if (partner.status === DeliveryPartnerStatus.SUSPENDED) {
      throw new BadRequestException('Delivery partner is already suspended');
    }

    return this.deliveryRepository.updatePartnerStatusById(deliveryPartnerId, DeliveryPartnerStatus.SUSPENDED);
  }

  async restorePartner(deliveryPartnerId: string) {
    const partner = await this.findAdminTarget(deliveryPartnerId);

    if (partner.status !== DeliveryPartnerStatus.SUSPENDED) {
      throw new BadRequestException('Only suspended partners can be restored');
    }

    return this.deliveryRepository.updatePartnerStatusById(deliveryPartnerId, DeliveryPartnerStatus.OFFLINE);
  }

  /** Admin-scoped variant of goOffline() — targets an arbitrary partner instead of the caller. */
  async forceOffline(deliveryPartnerId: string) {
    const partner = await this.findAdminTarget(deliveryPartnerId);

    if (partner.status !== DeliveryPartnerStatus.AVAILABLE && partner.status !== DeliveryPartnerStatus.ON_DELIVERY) {
      throw new BadRequestException('Delivery partner is not currently online');
    }

    return this.deliveryRepository.updatePartnerStatusById(deliveryPartnerId, DeliveryPartnerStatus.OFFLINE);
  }

  /** Account-level block, distinct from suspendPartner()'s operational-level suspension — delegates to UsersService, no duplicated status-transition logic. */
  async blockPartner(deliveryPartnerId: string, actingUserId: string) {
    const partner = await this.findAdminTarget(deliveryPartnerId);

    return this.usersService.blockUser(partner.userId, actingUserId);
  }

  async unblockPartner(deliveryPartnerId: string) {
    const partner = await this.findAdminTarget(deliveryPartnerId);

    return this.usersService.restoreUser(partner.userId);
  }
}
