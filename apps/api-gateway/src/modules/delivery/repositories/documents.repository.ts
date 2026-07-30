import { Injectable } from '@nestjs/common';

import { DeliveryDocumentType, VerificationStatus } from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import { BaseRepository } from '../../../infrastructure/database/repositories/base.repository';

@Injectable()
export class DocumentsRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  /** Latest version of every document for a partner — the default view for both the owner and
   *  the admin verification queue. */
  async findLatestByPartner(deliveryPartnerId: string) {
    return this.prisma.deliveryDocument.findMany({
      where: { deliveryPartnerId, isLatest: true, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(documentId: string) {
    return this.prisma.deliveryDocument.findFirst({
      where: { id: documentId, deletedAt: null },
    });
  }

  async findExpiring(withinDays: number) {
    const threshold = new Date(Date.now() + withinDays * 24 * 60 * 60 * 1000);

    return this.prisma.deliveryDocument.findMany({
      where: {
        isLatest: true,
        deletedAt: null,
        expiryDate: { lte: threshold, not: null },
        status: { not: VerificationStatus.EXPIRED },
      },
    });
  }

  async create(data: {
    deliveryPartnerId: string;
    vehicleId?: string;
    documentType: DeliveryDocumentType;
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
    return this.prisma.deliveryDocument.create({ data });
  }

  async markSuperseded(documentId: string) {
    return this.prisma.deliveryDocument.update({
      where: { id: documentId },
      data: { isLatest: false },
    });
  }

  async markVerified(documentId: string, verifiedById: string) {
    return this.prisma.deliveryDocument.update({
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
    return this.prisma.deliveryDocument.update({
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
    return this.prisma.deliveryDocument.update({
      where: { id: documentId },
      data: { deletedAt: new Date() },
    });
  }

  async createVersionHistoryEntry(data: {
    documentId: string;
    deliveryPartnerId: string;
    documentType: DeliveryDocumentType;
    version: number;
    storageUrl: string;
    fileName: string;
  }) {
    return this.prisma.documentVersion.create({ data });
  }

  async findVersionHistory(
    deliveryPartnerId: string,
    documentType: DeliveryDocumentType,
  ) {
    return this.prisma.documentVersion.findMany({
      where: { deliveryPartnerId, documentType },
      orderBy: { version: 'desc' },
    });
  }
}
