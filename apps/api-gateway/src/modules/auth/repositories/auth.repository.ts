import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import { BaseRepository } from '../../../infrastructure/database/repositories/base.repository';

@Injectable()
export class AuthRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async findUserByEmail(email: string) {
    return this.prisma.user.findFirst({
      where: {
        email,
        deletedAt: null,
      },
    });
  }

  async createUser(data: any) {
    return this.prisma.user.create({
      data,
    });
  }

  async createRefreshToken(data: any) {
    return this.prisma.refreshToken.create({
      data,
    });
  }
  async findRefreshToken(token: string) {
    return this.prisma.refreshToken.findUnique({
      where: {
        token,
      },

      include: {
        user: true,
      },
    });
  }

  async revokeRefreshToken(token: string) {
    return this.prisma.refreshToken.update({
      where: {
        token,
      },

      data: {
        revokedAt: new Date(),
      },
    });
  }
  async findUserById(userId: string) {
    return this.prisma.user.findFirst({
      where: {
        id: userId,
        deletedAt: null,
      },
    });
  }

  async revokeAllRefreshTokensForUser(userId: string) {
    return this.prisma.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
      },

      data: {
        revokedAt: new Date(),
      },
    });
  }
}
