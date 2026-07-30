import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import { BaseRepository } from '../../../infrastructure/database/repositories/base.repository';

@Injectable()
export class HolidaysRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async findAll(restaurantId: string, branchId?: string) {
    return this.prisma.restaurantHoliday.findMany({
      where: {
        restaurantId,
        ...(branchId ? { branchId } : {}),
      },
      orderBy: { date: 'asc' },
    });
  }

  async findById(id: string) {
    return this.prisma.restaurantHoliday.findUnique({ where: { id } });
  }

  async create(restaurantId: string, data: Record<string, unknown>) {
    return this.prisma.restaurantHoliday.create({
      data: { restaurantId, ...data } as any,
    });
  }

  async update(id: string, data: Record<string, unknown>) {
    return this.prisma.restaurantHoliday.update({
      where: { id },
      data: data as any,
    });
  }

  async remove(id: string) {
    return this.prisma.restaurantHoliday.delete({ where: { id } });
  }
}
