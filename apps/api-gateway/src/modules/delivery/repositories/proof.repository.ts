import { Injectable } from '@nestjs/common';

import { DeliveryProofOtpStatus, DeliveryProofType } from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

@Injectable()
export class ProofRepository {
  constructor(private readonly prisma: PrismaService) {}

  findOtp(orderId: string, type: DeliveryProofType) {
    return this.prisma.deliveryProofOtp.findUnique({
      where: { orderId_type: { orderId, type } },
    });
  }

  /** Generate and regenerate are the same operation — overwrites any existing row for this (orderId, type), resetting attempts/status. */
  upsertOtp(
    orderId: string,
    type: DeliveryProofType,
    otpHash: string,
    expiresAt: Date,
    maxAttempts: number,
  ) {
    return this.prisma.deliveryProofOtp.upsert({
      where: { orderId_type: { orderId, type } },
      create: {
        orderId,
        type,
        otpHash,
        expiresAt,
        maxAttempts,
      },
      update: {
        otpHash,
        expiresAt,
        maxAttempts,
        attempts: 0,
        status: DeliveryProofOtpStatus.PENDING,
        verifiedAt: null,
      },
    });
  }

  incrementAttempts(id: string, status?: DeliveryProofOtpStatus) {
    return this.prisma.deliveryProofOtp.update({
      where: { id },
      data: {
        attempts: { increment: 1 },
        ...(status ? { status } : {}),
      },
    });
  }

  markStatus(id: string, status: DeliveryProofOtpStatus) {
    return this.prisma.deliveryProofOtp.update({
      where: { id },
      data: { status },
    });
  }

  markVerified(id: string) {
    return this.prisma.deliveryProofOtp.update({
      where: { id },
      data: {
        status: DeliveryProofOtpStatus.VERIFIED,
        verifiedAt: new Date(),
      },
    });
  }
}
