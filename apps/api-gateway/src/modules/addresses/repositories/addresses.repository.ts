import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import { BaseRepository } from '../../../infrastructure/database/repositories/base.repository';

@Injectable()
export class AddressesRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async findAllForCustomer(customerId: string) {
    return this.prisma.address.findMany({
      where: { customerId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async findByIdForCustomer(addressId: string, customerId: string) {
    return this.prisma.address.findFirst({
      where: { id: addressId, customerId },
    });
  }

  async countForCustomer(customerId: string): Promise<number> {
    return this.prisma.address.count({ where: { customerId } });
  }

  async unsetDefaultForCustomer(customerId: string) {
    return this.prisma.address.updateMany({
      where: { customerId, isDefault: true },
      data: { isDefault: false },
    });
  }

  async create(data: any) {
    return this.prisma.address.create({ data });
  }

  async update(addressId: string, data: any) {
    return this.prisma.address.update({
      where: { id: addressId },
      data,
    });
  }

  async delete(addressId: string) {
    return this.prisma.address.delete({ where: { id: addressId } });
  }

  async promoteMostRecentToDefault(customerId: string) {
    const mostRecent = await this.prisma.address.findFirst({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
    });

    if (!mostRecent) {
      return;
    }

    return this.prisma.address.update({
      where: { id: mostRecent.id },
      data: { isDefault: true },
    });
  }
}
