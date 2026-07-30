import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import { BaseRepository } from '../../../infrastructure/database/repositories/base.repository';

@Injectable()
export class VehiclesRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async findActiveByPartner(deliveryPartnerId: string) {
    return this.prisma.deliveryVehicle.findMany({
      where: { deliveryPartnerId, isActive: true },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async findById(vehicleId: string) {
    return this.prisma.deliveryVehicle.findUnique({ where: { id: vehicleId } });
  }

  async countActiveByPartner(deliveryPartnerId: string): Promise<number> {
    return this.prisma.deliveryVehicle.count({
      where: { deliveryPartnerId, isActive: true },
    });
  }

  async create(data: {
    deliveryPartnerId: string;
    vehicleType: string;
    registrationNumber: string;
    brand?: string;
    model?: string;
    year?: number;
    fuelType?: string;
    color?: string;
    isPrimary: boolean;
  }) {
    return this.prisma.deliveryVehicle.create({ data: data as never });
  }

  async update(
    vehicleId: string,
    data: Partial<{
      registrationNumber: string;
      brand: string;
      model: string;
      year: number;
      fuelType: string;
      color: string;
    }>,
  ) {
    return this.prisma.deliveryVehicle.update({
      where: { id: vehicleId },
      data: data as never,
    });
  }

  /** Used before inserting a new primary vehicle (the row doesn't exist yet, so there's nothing
   *  to exclude by id). */
  async unsetAllPrimary(deliveryPartnerId: string) {
    return this.prisma.deliveryVehicle.updateMany({
      where: { deliveryPartnerId },
      data: { isPrimary: false },
    });
  }

  /** Unsets isPrimary on every other active vehicle for this partner, then sets it on vehicleId
   *  — run as a transaction so exactly one vehicle is ever primary at a time. */
  async setPrimary(deliveryPartnerId: string, vehicleId: string) {
    return this.prisma.$transaction([
      this.prisma.deliveryVehicle.updateMany({
        where: { deliveryPartnerId, id: { not: vehicleId } },
        data: { isPrimary: false },
      }),
      this.prisma.deliveryVehicle.update({
        where: { id: vehicleId },
        data: { isPrimary: true },
      }),
    ]);
  }

  /** Replacement workflow — deactivates rather than deletes, so document history stays intact. */
  async deactivate(vehicleId: string) {
    return this.prisma.deliveryVehicle.update({
      where: { id: vehicleId },
      data: { isActive: false, isPrimary: false },
    });
  }

  async updateExpiryField(
    vehicleId: string,
    field:
      | 'insuranceExpiryAt'
      | 'rcExpiryAt'
      | 'fitnessExpiryAt'
      | 'pollutionExpiryAt',
    value: Date,
  ) {
    return this.prisma.deliveryVehicle.update({
      where: { id: vehicleId },
      data: { [field]: value },
    });
  }
}
