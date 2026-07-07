import { Injectable } from '@nestjs/common';

import { UserRole, UserStatus } from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import { BaseRepository } from '../../../infrastructure/database/repositories/base.repository';

export interface FindAllUsersParams {
  skip: number;
  take: number;
  search?: string;
  role?: UserRole;
  status?: UserStatus;
}

@Injectable()
export class UsersRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async findById(userId: string) {
    return this.prisma.user.findUnique({
      where: {
        id: userId,
      },
    });
  }

  async updateProfile(
    userId: string,

    data: any,
  ) {
    return this.prisma.user.update({
      where: {
        id: userId,
      },

      data,
    });
  }

  async findAllUsers(params: FindAllUsersParams): Promise<{ items: any[]; total: number }> {
    const where: any = {};

    if (params.role) {
      where.role = params.role;
    }

    if (params.status) {
      where.status = params.status;
    }

    if (params.search) {
      where.OR = [
        { firstName: { contains: params.search, mode: 'insensitive' } },
        { lastName: { contains: params.search, mode: 'insensitive' } },
        { email: { contains: params.search, mode: 'insensitive' } },
        { phone: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,

        skip: params.skip,

        take: params.take,

        orderBy: {
          createdAt: 'desc',
        },
      }),

      this.prisma.user.count({
        where,
      }),
    ]);

    return { items, total };
  }

  async countByRole(role: UserRole): Promise<number> {
    return this.prisma.user.count({
      where: {
        role,
      },
    });
  }

  async updateStatus(userId: string, status: UserStatus) {
    return this.prisma.user.update({
      where: {
        id: userId,
      },

      data: {
        status,
      },
    });
  }
}
