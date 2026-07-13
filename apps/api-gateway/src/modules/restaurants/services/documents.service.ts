import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { AuditAction } from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import { DocumentsRepository } from '../repositories/documents.repository';

import { UploadDocumentDto } from '../dto/upload-document.dto';

import { StorageService } from '../../storage/services/storage.service';
import { UploadFile } from '../../../shared/types/upload-file.type';

import { AuditService } from '../../audit/services/audit.service';
import { EventBusService } from '../../../core/events/event-bus.service';
import {
  AuthenticatedUser,
  canAccessRestaurant,
} from '../../../shared/authorization/order-access.util';

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documentsRepository: DocumentsRepository,
    private readonly storageService: StorageService,
    private readonly auditService: AuditService,
    private readonly eventBus: EventBusService,
  ) {}

  async findAll(restaurantId: string, user: AuthenticatedUser) {
    if (!(await canAccessRestaurant(this.prisma, restaurantId, user))) {
      throw new ForbiddenException('You do not have access to this restaurant');
    }

    return this.documentsRepository.findLatestByRestaurant(restaurantId);
  }

  async upload(
    restaurantId: string,
    dto: UploadDocumentDto,
    file: UploadFile,
    user: AuthenticatedUser,
  ) {
    if (!(await canAccessRestaurant(this.prisma, restaurantId, user))) {
      throw new ForbiddenException(
        'You do not have permission to upload documents for this restaurant',
      );
    }

    let previousVersion: Awaited<ReturnType<DocumentsRepository['findById']>> =
      null;

    if (dto.previousVersionId) {
      previousVersion = await this.documentsRepository.findById(
        dto.previousVersionId,
      );

      if (!previousVersion || previousVersion.restaurantId !== restaurantId) {
        throw new NotFoundException('Previous document version not found');
      }
    }

    const storageUrl = await this.storageService.upload(
      file,
      'restaurants/documents',
    );

    const document = await this.documentsRepository.create({
      restaurantId,
      branchId: dto.branchId,
      documentType: dto.documentType,
      documentNumber: dto.documentNumber,
      issueDate: dto.issueDate,
      expiryDate: dto.expiryDate,
      storageUrl,
      fileName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      uploadedById: user.userId,
      version: previousVersion ? previousVersion.version + 1 : 1,
      previousVersionId: dto.previousVersionId,
    });

    if (previousVersion) {
      await this.documentsRepository.markSuperseded(previousVersion.id);
    }

    await this.auditService.log(
      user.userId,
      'RestaurantDocument',
      document.id,
      AuditAction.CREATE,
      null,
      { documentType: document.documentType, restaurantId },
    );

    await this.eventBus.publish('restaurant.document.uploaded', {
      restaurantId,
      documentId: document.id,
      documentType: document.documentType,
    });

    return document;
  }

  async verify(
    restaurantId: string,
    documentId: string,
    user: AuthenticatedUser,
  ) {
    const document = await this.requireDocument(restaurantId, documentId);

    const verified = await this.documentsRepository.markVerified(
      documentId,
      user.userId,
    );

    await this.auditService.log(
      user.userId,
      'RestaurantDocument',
      documentId,
      AuditAction.APPROVE,
      { status: document.status },
      { status: 'VERIFIED' },
    );

    await this.eventBus.publish('restaurant.document.verified', {
      restaurantId,
      documentId,
      status: 'VERIFIED',
    });

    return verified;
  }

  async reject(
    restaurantId: string,
    documentId: string,
    reason: string,
    user: AuthenticatedUser,
  ) {
    const document = await this.requireDocument(restaurantId, documentId);

    const rejected = await this.documentsRepository.markRejected(
      documentId,
      user.userId,
      reason,
    );

    await this.auditService.log(
      user.userId,
      'RestaurantDocument',
      documentId,
      AuditAction.REJECT,
      { status: document.status },
      { status: 'REJECTED', reason },
    );

    await this.eventBus.publish('restaurant.document.verified', {
      restaurantId,
      documentId,
      status: 'REJECTED',
    });

    return rejected;
  }

  async remove(
    restaurantId: string,
    documentId: string,
    user: AuthenticatedUser,
  ) {
    await this.requireDocument(restaurantId, documentId);

    if (!(await canAccessRestaurant(this.prisma, restaurantId, user))) {
      throw new ForbiddenException(
        'You do not have permission to remove documents for this restaurant',
      );
    }

    const removed = await this.documentsRepository.softDelete(documentId);

    await this.auditService.log(
      user.userId,
      'RestaurantDocument',
      documentId,
      AuditAction.DELETE,
      null,
      null,
    );

    return removed;
  }

  private async requireDocument(restaurantId: string, documentId: string) {
    const document = await this.documentsRepository.findById(documentId);

    if (!document || document.restaurantId !== restaurantId) {
      throw new NotFoundException('Document not found');
    }

    return document;
  }
}
