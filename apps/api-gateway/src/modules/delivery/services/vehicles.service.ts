import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { AuditAction } from '@prisma/client';

import { DeliveryRepository } from '../repositories/delivery.repository';
import { VehiclesRepository } from '../repositories/vehicles.repository';

import { CreateVehicleDto } from '../dto/create-vehicle.dto';
import { UpdateVehicleDto } from '../dto/update-vehicle.dto';

import { AuditService } from '../../audit/services/audit.service';
import { EventBusService } from '../../../core/events/event-bus.service';

/**
 * Delivery partners are 1:1 with a User (no restaurant-style staff RBAC), so every self-service
 * method resolves the caller's own DeliveryPartner via userId and checks ownership inline —
 * mirroring DeliveryService/DispatchService rather than canAccessRestaurant/hasRestaurantRole,
 * which are shaped for restaurant multi-staff access.
 */
@Injectable()
export class VehiclesService {
  constructor(
    private readonly deliveryRepository: DeliveryRepository,
    private readonly vehiclesRepository: VehiclesRepository,
    private readonly auditService: AuditService,
    private readonly eventBus: EventBusService,
  ) {}

  private async requirePartner(userId: string) {
    const partner = await this.deliveryRepository.findPartnerByUserId(userId);

    if (!partner) {
      throw new NotFoundException('Delivery partner not found');
    }

    return partner;
  }

  async list(userId: string) {
    const partner = await this.requirePartner(userId);

    return this.vehiclesRepository.findActiveByPartner(partner.id);
  }

  async create(userId: string, dto: CreateVehicleDto) {
    const partner = await this.requirePartner(userId);

    const existingCount = await this.vehiclesRepository.countActiveByPartner(
      partner.id,
    );

    // The first vehicle a partner registers is always primary, regardless of the request body.
    const isPrimary = existingCount === 0 ? true : (dto.isPrimary ?? false);

    if (isPrimary && existingCount > 0) {
      await this.vehiclesRepository.unsetAllPrimary(partner.id);
    }

    const vehicle = await this.vehiclesRepository.create({
      deliveryPartnerId: partner.id,
      vehicleType: dto.vehicleType,
      registrationNumber: dto.registrationNumber,
      brand: dto.brand,
      model: dto.model,
      year: dto.year,
      fuelType: dto.fuelType,
      color: dto.color,
      isPrimary,
    });

    await this.auditService.log(
      userId,
      'DeliveryVehicle',
      vehicle.id,
      AuditAction.CREATE,
      null,
      { registrationNumber: vehicle.registrationNumber },
    );

    await this.eventBus.publish('delivery.vehicle.updated', {
      deliveryPartnerId: partner.id,
      vehicleId: vehicle.id,
    });

    return vehicle;
  }

  private async requireOwnedVehicle(userId: string, vehicleId: string) {
    const partner = await this.requirePartner(userId);
    const vehicle = await this.vehiclesRepository.findById(vehicleId);

    if (!vehicle || vehicle.deliveryPartnerId !== partner.id) {
      throw new NotFoundException('Vehicle not found');
    }

    return { partner, vehicle };
  }

  async update(userId: string, vehicleId: string, dto: UpdateVehicleDto) {
    const { vehicle } = await this.requireOwnedVehicle(userId, vehicleId);

    const updated = await this.vehiclesRepository.update(vehicleId, dto);

    await this.auditService.log(
      userId,
      'DeliveryVehicle',
      vehicleId,
      AuditAction.UPDATE,
      { registrationNumber: vehicle.registrationNumber },
      dto,
    );

    await this.eventBus.publish('delivery.vehicle.updated', {
      deliveryPartnerId: vehicle.deliveryPartnerId,
      vehicleId,
    });

    return updated;
  }

  async setPrimary(userId: string, vehicleId: string) {
    const { partner, vehicle } = await this.requireOwnedVehicle(
      userId,
      vehicleId,
    );

    if (!vehicle.isActive) {
      throw new BadRequestException(
        'Only an active vehicle can be set as primary',
      );
    }

    await this.vehiclesRepository.setPrimary(partner.id, vehicleId);

    await this.auditService.log(
      userId,
      'DeliveryVehicle',
      vehicleId,
      AuditAction.UPDATE,
      null,
      { isPrimary: true },
    );

    return this.vehiclesRepository.findById(vehicleId);
  }

  /** Replacement workflow — deactivates rather than deletes, so document history stays intact. */
  async deactivate(userId: string, vehicleId: string) {
    const { vehicle } = await this.requireOwnedVehicle(userId, vehicleId);

    if (!vehicle.isActive) {
      throw new BadRequestException('Vehicle is already deactivated');
    }

    const deactivated = await this.vehiclesRepository.deactivate(vehicleId);

    await this.auditService.log(
      userId,
      'DeliveryVehicle',
      vehicleId,
      AuditAction.DELETE,
      null,
      { isActive: false },
    );

    return deactivated;
  }

  /** Ownership-checked defense-in-depth guard used by DocumentsService when a document is
   *  scoped to a vehicleId, and by ForbiddenException callers elsewhere in this module. */
  async assertOwnsVehicle(deliveryPartnerId: string, vehicleId: string) {
    const vehicle = await this.vehiclesRepository.findById(vehicleId);

    if (!vehicle || vehicle.deliveryPartnerId !== deliveryPartnerId) {
      throw new ForbiddenException('Vehicle does not belong to this partner');
    }

    return vehicle;
  }
}
