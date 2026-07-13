import { Injectable } from '@nestjs/common';

import { RestaurantDocumentType, VerificationStatus } from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import { BaseRepository } from '../../../infrastructure/database/repositories/base.repository';

@Injectable()
export class DocumentsRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  /** Latest version of every document for a restaurant — the default view for both the owner
   *  and the admin verification queue. */
  async findLatestByRestaurant(restaurantId: string) {
    return this.prisma.restaurantDocument.findMany({
      where: { restaurantId, isLatest: true, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(documentId: string) {
    return this.prisma.restaurantDocument.findFirst({
      where: { id: documentId, deletedAt: null },
    });
  }

  async findExpiring(withinDays: number) {
    const threshold = new Date(Date.now() + withinDays * 24 * 60 * 60 * 1000);

    return this.prisma.restaurantDocument.findMany({
      where: {
        isLatest: true,
        deletedAt: null,
        expiryDate: { lte: threshold, not: null },
        status: { not: VerificationStatus.EXPIRED },
      },
    });
  }

  async create(data: {
    restaurantId: string;
    branchId?: string;
    documentType: RestaurantDocumentType;
    documentNumber?: string;
    issueDate?: Date;
    expiryDate?: Date;
    storageUrl: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    uploadedById: string;
    version: number;
    previousVersionId?: string;
  }) {
    return this.prisma.restaurantDocument.create({ data });
  }

  async markSuperseded(documentId: string) {
    return this.prisma.restaurantDocument.update({
      where: { id: documentId },
      data: { isLatest: false },
    });
  }

  async markVerified(documentId: string, verifiedById: string) {
    return this.prisma.restaurantDocument.update({
      where: { id: documentId },
      data: {
        status: VerificationStatus.VERIFIED,
        verifiedById,
        verifiedAt: new Date(),
        rejectedReason: null,
      },
    });
  }

  async markRejected(documentId: string, verifiedById: string, reason: string) {
    return this.prisma.restaurantDocument.update({
      where: { id: documentId },
      data: {
        status: VerificationStatus.REJECTED,
        verifiedById,
        verifiedAt: new Date(),
        rejectedReason: reason,
      },
    });
  }

  async softDelete(documentId: string) {
    return this.prisma.restaurantDocument.update({
      where: { id: documentId },
      data: { deletedAt: new Date() },
    });
  }
}
