import { Injectable } from '@nestjs/common';

import {
  AssignmentStatus,
  DeliveryProofOtpStatus,
  DeliveryProofType,
  Prisma,
  type DeliveryProofOtp,
} from '@prisma/client';

export type IssueOtpResult =
  | { issued: true; otp: DeliveryProofOtp }
  | {
      issued: false;
      reason: 'verified' | 'limit' | 'cooldown';
      existing: DeliveryProofOtp;
    };

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

  /**
   * Issues (or re-issues) the OTP for this (orderId, type) atomically, enforcing the resend
   * cooldown and the per-order issue cap when `limits` is given. A re-issue replaces the code
   * and resets the attempt counter, but only through a conditional update whose WHERE clause
   * re-checks — at write time, under the row lock — that:
   *   - the current code was not already VERIFIED (a successful verification is never undone),
   *   - fewer than `maxGenerations` codes have been issued, and
   *   - the last code was issued at least `cooldownMs` ago.
   * So concurrent "resend" taps can issue at most one code. Returns the issued row, or the
   * reason nothing was issued (with the existing row, so the caller can explain/compute a wait).
   */
  async issueOtp(params: {
    orderId: string;
    type: DeliveryProofType;
    otpHash: string;
    expiresAt: Date;
    maxAttempts: number;
    limits?: { cooldownMs: number; maxGenerations: number };
  }): Promise<IssueOtpResult> {
    const { orderId, type, otpHash, expiresAt, maxAttempts, limits } = params;
    const now = new Date();

    const existing = await this.findOtp(orderId, type);

    if (!existing) {
      try {
        const otp = await this.prisma.deliveryProofOtp.create({
          data: {
            orderId,
            type,
            otpHash,
            expiresAt,
            maxAttempts,
            generationCount: 1,
            lastGeneratedAt: now,
          },
        });
        return { issued: true, otp };
      } catch (error) {
        // A concurrent first request created the row a moment ago — that request issued the
        // code; this one is, by definition, inside the cooldown window.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          const winner = await this.findOtp(orderId, type);
          if (winner) {
            return { issued: false, reason: 'cooldown', existing: winner };
          }
        }
        throw error;
      }
    }

    const claim = await this.prisma.deliveryProofOtp.updateMany({
      where: {
        id: existing.id,
        status: { not: DeliveryProofOtpStatus.VERIFIED },
        ...(limits
          ? {
              generationCount: { lt: limits.maxGenerations },
              lastGeneratedAt: {
                lte: new Date(now.getTime() - limits.cooldownMs),
              },
            }
          : {}),
      },
      data: {
        otpHash,
        expiresAt,
        maxAttempts,
        attempts: 0,
        status: DeliveryProofOtpStatus.PENDING,
        verifiedAt: null,
        generationCount: { increment: 1 },
        lastGeneratedAt: now,
      },
    });

    const current = await this.prisma.deliveryProofOtp.findUniqueOrThrow({
      where: { id: existing.id },
    });

    if (claim.count > 0) {
      return { issued: true, otp: current };
    }

    if (current.status === DeliveryProofOtpStatus.VERIFIED) {
      return { issued: false, reason: 'verified', existing: current };
    }

    if (limits && current.generationCount >= limits.maxGenerations) {
      return { issued: false, reason: 'limit', existing: current };
    }

    return { issued: false, reason: 'cooldown', existing: current };
  }

  /**
   * Records one failed attempt atomically and returns the row as it stands afterwards, or null if
   * the OTP was no longer PENDING with attempts to spare (another request exhausted, verified or
   * regenerated it first). The previous read-then-`increment` let concurrent wrong guesses all
   * compute their "next attempt" from the same stale count, so none of them ever flipped the row
   * to EXCEEDED and a burst could test far more than `maxAttempts` codes. The conditional
   * `attempts < maxAttempts` claim makes the cap hold under concurrency; the follow-up update marks
   * EXCEEDED once the cap is reached.
   */
  async recordFailedAttempt(id: string, maxAttempts: number) {
    const claim = await this.prisma.deliveryProofOtp.updateMany({
      where: {
        id,
        status: DeliveryProofOtpStatus.PENDING,
        attempts: { lt: maxAttempts },
      },
      data: { attempts: { increment: 1 } },
    });

    if (claim.count === 0) {
      return null;
    }

    const updated = await this.prisma.deliveryProofOtp.findUniqueOrThrow({
      where: { id },
    });

    if (updated.attempts >= maxAttempts) {
      await this.prisma.deliveryProofOtp.updateMany({
        where: { id, status: DeliveryProofOtpStatus.PENDING },
        data: { status: DeliveryProofOtpStatus.EXCEEDED },
      });

      return { ...updated, status: DeliveryProofOtpStatus.EXCEEDED };
    }

    return updated;
  }

  markStatus(id: string, status: DeliveryProofOtpStatus) {
    return this.prisma.deliveryProofOtp.update({
      where: { id },
      data: { status },
    });
  }

  /**
   * Claims the PENDING → VERIFIED transition atomically. Returns false when another request
   * already verified (or exhausted/regenerated) this OTP, so two concurrent correct submissions
   * can never both go on to advance the order.
   */
  async markVerifiedIfPending(id: string): Promise<boolean> {
    const claim = await this.prisma.deliveryProofOtp.updateMany({
      where: { id, status: DeliveryProofOtpStatus.PENDING },
      data: {
        status: DeliveryProofOtpStatus.VERIFIED,
        verifiedAt: new Date(),
      },
    });

    return claim.count > 0;
  }

  /** Undoes markVerifiedIfPending when the order transition it was meant to unlock failed, so the
   *  OTP isn't left "already verified" against an order that never advanced. */
  revertVerification(id: string) {
    return this.prisma.deliveryProofOtp.updateMany({
      where: { id, status: DeliveryProofOtpStatus.VERIFIED },
      data: { status: DeliveryProofOtpStatus.PENDING, verifiedAt: null },
    });
  }
}
