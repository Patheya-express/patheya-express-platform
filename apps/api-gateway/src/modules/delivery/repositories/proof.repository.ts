import { Injectable } from '@nestjs/common';

import {
  AssignmentStatus,
  DeliveryProofOtpStatus,
  DeliveryProofType,
} from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

@Injectable()
export class ProofRepository {
  constructor(private readonly prisma: PrismaService) {}

  findPhoto(orderId: string, type: DeliveryProofType) {
    return this.prisma.deliveryProofPhoto.findUnique({
      where: { orderId_type: { orderId, type } },
    });
  }

  /** No upsert here on purpose — DeliveryProofPhoto is write-once evidence (see the model's doc
   *  comment in schema.prisma). A caller that finds an existing row must reject, not overwrite. */
  createPhoto(data: {
    orderId: string;
    type: DeliveryProofType;
    storageUrl: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    uploadedById: string;
  }) {
    return this.prisma.deliveryProofPhoto.create({ data });
  }

  /** DeliveryAssignment.deliveryPartnerId is a DeliveryPartner.id, not a User.id — the nested
   *  relation filter resolves the caller's authenticated User.id to "their" assignment for this
   *  order in one query rather than requiring a separate DeliveryPartner lookup first. Used for
   *  the arrival mutation, where "is there currently an active, accepted assignment" is itself
   *  the security precondition being checked. */
  findActiveAssignmentForOrder(orderId: string, userId: string) {
    return this.prisma.deliveryAssignment.findFirst({
      where: {
        orderId,
        status: AssignmentStatus.ACCEPTED,
        deliveryPartner: { userId },
      },
    });
  }

  /** Same lookup, without the ACCEPTED filter — for read-only status checks (e.g. "did the rider
   *  ever arrive"), which should keep answering correctly after the assignment later moves to
   *  COMPLETED (order delivered), not just while it's still active. */
  findAssignmentForOrder(orderId: string, userId: string) {
    return this.prisma.deliveryAssignment.findFirst({
      where: { orderId, deliveryPartner: { userId } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Conditional update (not a plain set) so two concurrent arrival requests can't race each
   *  other into recording two different timestamps — only the first ever commits; a caller who
   *  loses the race re-reads the row that already has arrivedAtRestaurantAt set (idempotent
   *  success, not an error, per the business rule that repeated arrival must not be inconsistent). */
  async markArrival(assignmentId: string) {
    await this.prisma.deliveryAssignment.updateMany({
      where: { id: assignmentId, arrivedAtRestaurantAt: null },
      data: { arrivedAtRestaurantAt: new Date() },
    });

    return this.prisma.deliveryAssignment.findUniqueOrThrow({
      where: { id: assignmentId },
    });
  }

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
