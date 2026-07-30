import { Injectable } from '@nestjs/common';

import { RestaurantStaffStatus } from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import { BaseRepository } from '../../../infrastructure/database/repositories/base.repository';

const STAFF_USER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
} as const;

@Injectable()
export class StaffRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async findManyByRestaurant(restaurantId: string) {
    return this.prisma.restaurantStaff.findMany({
      where: { restaurantId },
      include: { user: { select: STAFF_USER_SELECT } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findById(staffId: string) {
    return this.prisma.restaurantStaff.findUnique({
      where: { id: staffId },
      include: { user: { select: STAFF_USER_SELECT } },
    });
  }

  async findByRestaurantAndUser(restaurantId: string, userId: string) {
    return this.prisma.restaurantStaff.findUnique({
      where: { restaurantId_userId: { restaurantId, userId } },
    });
  }

  async create(data: {
    restaurantId: string;
    userId: string;
    branchId?: string;
    role: string;
    invitedById: string;
  }) {
    return this.prisma.restaurantStaff.create({
      data: data as never,
      include: { user: { select: STAFF_USER_SELECT } },
    });
  }

  async update(staffId: string, data: any) {
    return this.prisma.restaurantStaff.update({
      where: { id: staffId },
      data,
      include: { user: { select: STAFF_USER_SELECT } },
    });
  }

  async accept(staffId: string) {
    return this.prisma.restaurantStaff.update({
      where: { id: staffId },
      data: { status: RestaurantStaffStatus.ACTIVE, respondedAt: new Date() },
      include: { user: { select: STAFF_USER_SELECT } },
    });
  }

  async revoke(staffId: string) {
    return this.prisma.restaurantStaff.update({
      where: { id: staffId },
      data: { status: RestaurantStaffStatus.REVOKED, respondedAt: new Date() },
    });
  }
}
