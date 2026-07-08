import { Injectable } from '@nestjs/common';

import {
  UserRole,
  UserStatus,
  ThemePreference,
  User,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import { BaseRepository } from '../../../infrastructure/database/repositories/base.repository';

export interface FindAllUsersParams {
  skip: number;
  take: number;
  search?: string;
  role?: UserRole;
  status?: UserStatus;
}

export interface UpdateProfileData {
  firstName?: string;
  lastName?: string;
  phone?: string;
  preferredLanguage?: string;
  themePreference?: ThemePreference;
  marketingOptIn?: boolean;
  timezone?: string;
}

export interface UpdateNotificationPreferencesData {
  orderUpdatesEmail?: boolean;
  orderUpdatesSms?: boolean;
  orderUpdatesPush?: boolean;
  promotionsEmail?: boolean;
  promotionsSms?: boolean;
  promotionsPush?: boolean;
  reviewsEmail?: boolean;
  reviewsSms?: boolean;
  reviewsPush?: boolean;
  systemEmail?: boolean;
  systemSms?: boolean;
  systemPush?: boolean;
}

@Injectable()
export class UsersRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async findById(userId: string) {
    return this.prisma.user.findFirst({
      where: {
        id: userId,
        deletedAt: null,
      },

      omit: {
        passwordHash: true,
      },
    });
  }

  /** Includes passwordHash — only for internal use by password-change verification, never returned to a client. */
  async findByIdWithPassword(userId: string) {
    return this.prisma.user.findFirst({
      where: {
        id: userId,
        deletedAt: null,
      },
    });
  }

  async updateProfile(
    userId: string,

    data: UpdateProfileData,
  ) {
    const updated = await this.prisma.user.update({
      where: {
        id: userId,
      },

      data,

      omit: {
        passwordHash: true,
      },
    });

    return updated;
  }

  async updatePassword(userId: string, passwordHash: string) {
    await this.prisma.user.update({
      where: {
        id: userId,
      },

      data: {
        passwordHash,
      },
    });
  }

  async updateAvatar(userId: string, avatarUrl: string) {
    return this.prisma.user.update({
      where: {
        id: userId,
      },

      data: {
        avatarUrl,
      },

      omit: {
        passwordHash: true,
      },
    });
  }

  /**
   * Soft delete only — never a hard delete. email/phone are cleared (not just the row marked
   * deleted) so the freed values can be reused by a future registration; Postgres treats
   * multiple NULLs as distinct under a unique index, so this doesn't collide across accounts.
   */
  async softDeleteAccount(userId: string) {
    await this.prisma.user.update({
      where: {
        id: userId,
      },

      data: {
        deletedAt: new Date(),
        passwordHash: null,
        email: null,
        phone: null,
      },
    });
  }

  async getNotificationPreferences(userId: string) {
    return this.prisma.notificationPreference.findUnique({
      where: {
        userId,
      },
    });
  }

  async upsertNotificationPreferences(
    userId: string,

    data: UpdateNotificationPreferencesData,
  ) {
    return this.prisma.notificationPreference.upsert({
      where: {
        userId,
      },

      update: data,

      create: {
        userId,
        ...data,
      },
    });
  }

  async findAllUsers(
    params: FindAllUsersParams,
  ): Promise<{ items: Omit<User, 'passwordHash'>[]; total: number }> {
    const where: Prisma.UserWhereInput = { deletedAt: null };

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

        omit: {
          passwordHash: true,
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
