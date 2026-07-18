import { Injectable, NotFoundException } from '@nestjs/common';

import { AuditAction } from '@prisma/client';

import { DeliveryRepository } from '../repositories/delivery.repository';
import { DocumentsRepository } from '../repositories/documents.repository';
import { VehiclesService } from './vehicles.service';

import { UploadDeliveryDocumentDto } from '../dto/upload-delivery-document.dto';

import { StorageService } from '../../storage/services/storage.service';
import { UploadFile } from '../../../shared/types/upload-file.type';

import { AuditService } from '../../audit/services/audit.service';
import { EventBusService } from '../../../core/events/event-bus.service';

@Injectable()
export class DocumentsService {
  constructor(
    private readonly deliveryRepository: DeliveryRepository,
    private readonly documentsRepository: DocumentsRepository,
    private readonly vehiclesService: VehiclesService,
    private readonly storageService: StorageService,
    private readonly auditService: AuditService,
    private readonly eventBus: EventBusService,
  ) {}

  private async requirePartner(userId: string) {
    const partner = await this.deliveryRepository.findPartnerByUserId(userId);

    if (!partner) {
      throw new NotFoundException('Delivery partner not found');
    }

    return partner;
  }

  async findAllForSelf(userId: string) {
    const partner = await this.requirePartner(userId);

    return this.documentsRepository.findLatestByPartner(partner.id);
  }

  async findAllForAdmin(deliveryPartnerId: string) {
    return this.documentsRepository.findLatestByPartner(deliveryPartnerId);
  }

  async upload(
    userId: string,
    dto: UploadDeliveryDocumentDto,
    file: UploadFile,
  ) {
    const partner = await this.requirePartner(userId);

    if (dto.vehicleId) {
      await this.vehiclesService.assertOwnsVehicle(partner.id, dto.vehicleId);
    }

    let previousVersion: Awaited<ReturnType<DocumentsRepository['findById']>> =
      null;

    if (dto.previousVersionId) {
      previousVersion = await this.documentsRepository.findById(
        dto.previousVersionId,
      );

      if (
        !previousVersion ||
        previousVersion.deliveryPartnerId !== partner.id
      ) {
        throw new NotFoundException('Previous document version not found');
      }
    }

    const storageUrl = await this.storageService.upload(
      file,
      'delivery-partners/documents',
    );

    const version = previousVersion ? previousVersion.version + 1 : 1;

    const document = await this.documentsRepository.create({
      deliveryPartnerId: partner.id,
      vehicleId: dto.vehicleId,
      documentType: dto.documentType,
      documentNumber: dto.documentNumber,
      issueDate: dto.issueDate,
      expiryDate: dto.expiryDate,
      storageUrl,
      fileName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      uploadedById: userId,
      version,
      previousVersionId: dto.previousVersionId,
    });

    if (previousVersion) {
      await this.documentsRepository.markSuperseded(previousVersion.id);
    }

    await this.documentsRepository.createVersionHistoryEntry({
      documentId: document.id,
      deliveryPartnerId: partner.id,
      documentType: document.documentType,
      version: document.version,
      storageUrl: document.storageUrl,
      fileName: document.fileName,
    });

    await this.auditService.log(
      userId,
      'DeliveryDocument',
      document.id,
      AuditAction.CREATE,
      null,
      { documentType: document.documentType, deliveryPartnerId: partner.id },
    );

    await this.eventBus.publish('delivery.document.uploaded', {
      deliveryPartnerId: partner.id,
      documentId: document.id,
      documentType: document.documentType,
    });

    return document;
  }

  private async requireDocument(deliveryPartnerId: string, documentId: string) {
    const document = await this.documentsRepository.findById(documentId);

    if (!document || document.deliveryPartnerId !== deliveryPartnerId) {
      throw new NotFoundException('Document not found');
    }

    return document;
  }

  /** Admin-only. */
  async verify(
    deliveryPartnerId: string,
    documentId: string,
    adminUserId: string,
  ) {
    const document = await this.requireDocument(deliveryPartnerId, documentId);

    const verified = await this.documentsRepository.markVerified(
      documentId,
      adminUserId,
    );

    await this.auditService.log(
      adminUserId,
      'DeliveryDocument',
      documentId,
      AuditAction.APPROVE,
      { status: document.status },
      { status: 'VERIFIED' },
    );

    await this.eventBus.publish('delivery.document.verified', {
      deliveryPartnerId,
      documentId,
      status: 'VERIFIED',
    });

    return verified;
  }

  /** Admin-only. */
  async reject(
    deliveryPartnerId: string,
    documentId: string,
    reason: string,
    adminUserId: string,
  ) {
    const document = await this.requireDocument(deliveryPartnerId, documentId);

    const rejected = await this.documentsRepository.markRejected(
      documentId,
      adminUserId,
      reason,
    );

    await this.auditService.log(
      adminUserId,
      'DeliveryDocument',
      documentId,
      AuditAction.REJECT,
      { status: document.status },
      { status: 'REJECTED', reason },
    );

    await this.eventBus.publish('delivery.document.verified', {
      deliveryPartnerId,
      documentId,
      status: 'REJECTED',
    });

    return rejected;
  }

  async remove(userId: string, documentId: string) {
    const partner = await this.requirePartner(userId);

    await this.requireDocument(partner.id, documentId);

    const removed = await this.documentsRepository.softDelete(documentId);

    await this.auditService.log(
      userId,
      'DeliveryDocument',
      documentId,
      AuditAction.DELETE,
      null,
      null,
    );

    return removed;
  }

  async historyForSelf(
    userId: string,
    documentType: UploadDeliveryDocumentDto['documentType'],
  ) {
    const partner = await this.requirePartner(userId);

    return this.documentsRepository.findVersionHistory(
      partner.id,
      documentType,
    );
  }

  async historyForAdmin(
    deliveryPartnerId: string,
    documentType: UploadDeliveryDocumentDto['documentType'],
  ) {
    return this.documentsRepository.findVersionHistory(
      deliveryPartnerId,
      documentType,
    );
  }
}
