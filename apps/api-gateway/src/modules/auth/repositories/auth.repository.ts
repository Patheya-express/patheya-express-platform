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

  async updateUserPassword(userId: string, passwordHash: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
  }

  async createPasswordResetToken(data: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }) {
    return this.prisma.passwordResetToken.create({ data });
  }

  async findPasswordResetToken(tokenHash: string) {
    return this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
  }

  async markPasswordResetTokenUsed(tokenHash: string) {
    return this.prisma.passwordResetToken.update({
      where: { tokenHash },
      data: { usedAt: new Date() },
    });
  }

  async findUserByReferralCode(referralCode: string) {
    return this.prisma.user.findUnique({
      where: { referralCode },
      select: { id: true },
    });
  }

  async setReferralCode(userId: string, referralCode: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { referralCode },
    });
  }

  /** No-op (returns null) if the referee has already been referred by someone — refereeId is unique. */
  async createReferral(referrerId: string, refereeId: string) {
    const existing = await this.prisma.referral.findUnique({
      where: { refereeId },
    });

    if (existing) {
      return null;
    }

    return this.prisma.referral.create({
      data: { referrerId, refereeId },
    });
  }
}
