import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import { BaseRepository } from '../../../infrastructure/database/repositories/base.repository';

@Injectable()
export class BranchesRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async findManyByRestaurant(restaurantId: string) {
    return this.prisma.restaurantBranch.findMany({
      where: { restaurantId, deletedAt: null },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async findById(branchId: string) {
    return this.prisma.restaurantBranch.findFirst({
      where: { id: branchId, deletedAt: null },
    });
  }

  async countByRestaurant(restaurantId: string): Promise<number> {
    return this.prisma.restaurantBranch.count({
      where: { restaurantId, deletedAt: null },
    });
  }

  async create(restaurantId: string, data: any) {
    return this.prisma.restaurantBranch.create({
      data: { ...data, restaurantId },
    });
  }

  async update(branchId: string, data: any) {
    return this.prisma.restaurantBranch.update({
      where: { id: branchId },
      data,
    });
  }

  async softDelete(branchId: string) {
    return this.prisma.restaurantBranch.update({
      where: { id: branchId },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  /** Unsets `isPrimary` on every other branch of the restaurant before the caller sets it on
   *  the new one, keeping "at most one primary branch" true without a DB-level constraint. */
  async clearPrimary(restaurantId: string, exceptBranchId?: string) {
    return this.prisma.restaurantBranch.updateMany({
      where: {
        restaurantId,
        deletedAt: null,
        ...(exceptBranchId ? { id: { not: exceptBranchId } } : {}),
      },
      data: { isPrimary: false },
    });
  }
}
