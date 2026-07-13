import { Injectable } from '@nestjs/common';

import { VerificationStatus } from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import { BaseRepository } from '../../../infrastructure/database/repositories/base.repository';

const BANK_ACCOUNT_SELECT = {
  id: true,
  restaurantId: true,
  accountHolderName: true,
  bankName: true,
  branchName: true,
  accountNumberLast4: true,
  ifsc: true,
  upiId: true,
  cancelledChequeDocumentId: true,
  verificationStatus: true,
  verifiedAt: true,
  payoutProviderRef: true,
  createdAt: true,
  updatedAt: true,
  // Deliberately excludes accountNumberEncrypted — every read goes through this select so the
  // ciphertext can never leak into an API response by accident.
} as const;

@Injectable()
export class BankAccountRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async findByRestaurant(restaurantId: string) {
    return this.prisma.restaurantBankAccount.findUnique({
      where: { restaurantId },
      select: BANK_ACCOUNT_SELECT,
    });
  }

  async upsert(
    restaurantId: string,
    data: {
      accountHolderName: string;
      bankName: string;
      branchName?: string;
      accountNumberEncrypted: string;
      accountNumberLast4: string;
      ifsc: string;
      upiId?: string;
      cancelledChequeDocumentId?: string;
    },
  ) {
    return this.prisma.restaurantBankAccount.upsert({
      where: { restaurantId },
      create: {
        restaurantId,
        ...data,
        verificationStatus: VerificationStatus.PENDING,
      },
      update: { ...data, verificationStatus: VerificationStatus.PENDING },
      select: BANK_ACCOUNT_SELECT,
    });
  }

  async markVerified(restaurantId: string, verifiedById: string) {
    return this.prisma.restaurantBankAccount.update({
      where: { restaurantId },
      data: {
        verificationStatus: VerificationStatus.VERIFIED,
        verifiedById,
        verifiedAt: new Date(),
      },
      select: BANK_ACCOUNT_SELECT,
    });
  }

  async markRejected(restaurantId: string) {
    return this.prisma.restaurantBankAccount.update({
      where: { restaurantId },
      data: { verificationStatus: VerificationStatus.REJECTED },
      select: BANK_ACCOUNT_SELECT,
    });
  }
}
