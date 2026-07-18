import { Injectable, NotFoundException } from '@nestjs/common';

import { DeliveryDocumentType, VerificationStatus } from '@prisma/client';

import { DeliveryRepository } from '../repositories/delivery.repository';
import { DocumentsRepository } from '../repositories/documents.repository';
import { VerificationRepository } from '../repositories/verification.repository';
import { BankAccountRepository } from '../repositories/bank-account.repository';
import { ComplianceRepository } from '../repositories/compliance.repository';

import { DeliveryComplianceResponseDto } from '../dto/delivery-compliance-response.dto';

const EXPIRY_WINDOW_DAYS = 30;

/** The documents a partner must have at least one VERIFIED (or non-rejected) copy of to be
 *  considered document-complete — mirrors the 12-step wizard's mandatory document steps
 *  (Driving License, Aadhaar, PAN, RC, Insurance, Selfie, Background Verification). Bank account
 *  verification is tracked separately via DeliveryBankAccount, not a document type. */
const REQUIRED_DOCUMENT_TYPES: DeliveryDocumentType[] = [
  DeliveryDocumentType.DRIVING_LICENSE,
  DeliveryDocumentType.AADHAAR,
  DeliveryDocumentType.PAN,
  DeliveryDocumentType.VEHICLE_RC,
  DeliveryDocumentType.VEHICLE_INSURANCE,
  DeliveryDocumentType.SELFIE,
  DeliveryDocumentType.BACKGROUND_VERIFICATION,
];

/**
 * The delivery-partner analog of RestaurantsComplianceService — computed on demand from
 * DeliveryVerification + DeliveryDocument + DeliveryBankAccount, then persisted as a
 * write-through cache row (see ComplianceRepository.upsertSnapshot).
 */
@Injectable()
export class ComplianceService {
  constructor(
    private readonly deliveryRepository: DeliveryRepository,
    private readonly documentsRepository: DocumentsRepository,
    private readonly verificationRepository: VerificationRepository,
    private readonly bankAccountRepository: BankAccountRepository,
    private readonly complianceRepository: ComplianceRepository,
  ) {}

  private async compute(
    deliveryPartnerId: string,
  ): Promise<DeliveryComplianceResponseDto> {
    const [verification, documents, bankAccount] = await Promise.all([
      this.verificationRepository.findOrCreate(deliveryPartnerId),
      this.documentsRepository.findLatestByPartner(deliveryPartnerId),
      this.bankAccountRepository.findByPartner(deliveryPartnerId),
    ]);

    const now = Date.now();
    const windowMs = EXPIRY_WINDOW_DAYS * 24 * 60 * 60 * 1000;

    const expired = documents.filter(
      (doc) => doc.expiryDate && doc.expiryDate.getTime() < now,
    );

    const expiringWithin30Days = documents.filter(
      (doc) =>
        doc.expiryDate &&
        doc.expiryDate.getTime() >= now &&
        doc.expiryDate.getTime() - now <= windowMs,
    );

    const documentsVerified = documents.filter(
      (doc) => doc.status === VerificationStatus.VERIFIED,
    ).length;

    const documentsRejected = documents.filter(
      (doc) => doc.status === VerificationStatus.REJECTED,
    ).length;

    const documentsPending =
      documents.length - documentsVerified - documentsRejected;

    const uploadedTypes = new Set(documents.map((doc) => doc.documentType));
    const missingDocumentTypes = REQUIRED_DOCUMENT_TYPES.filter(
      (type) => !uploadedTypes.has(type),
    );

    const hasBlockingIssue =
      verification.stage === 'REJECTED' ||
      verification.stage === 'SUSPENDED' ||
      documentsRejected > 0 ||
      bankAccount?.verificationStatus === VerificationStatus.REJECTED;

    const hasRisk =
      expired.length > 0 ||
      expiringWithin30Days.length > 0 ||
      documentsPending > 0 ||
      missingDocumentTypes.length > 0 ||
      verification.stage !== 'APPROVED';

    const overallStatus: DeliveryComplianceResponseDto['overallStatus'] =
      hasBlockingIssue ? 'NON_COMPLIANT' : hasRisk ? 'AT_RISK' : 'COMPLIANT';

    return {
      overallStatus,
      verificationStage: verification.stage,
      documentsTotal: documents.length,
      documentsVerified,
      documentsPending,
      documentsRejected,
      expiringWithin30Days: expiringWithin30Days.map((doc) => ({
        documentId: doc.id,
        documentType: doc.documentType,
        expiryDate: doc.expiryDate as Date,
      })),
      expired: expired.map((doc) => ({
        documentId: doc.id,
        documentType: doc.documentType,
        expiryDate: doc.expiryDate as Date,
      })),
      missingDocumentTypes,
      bankVerificationStatus: bankAccount?.verificationStatus,
    };
  }

  private async requirePartner(userId: string) {
    const partner = await this.deliveryRepository.findPartnerByUserId(userId);

    if (!partner) {
      throw new NotFoundException('Delivery partner not found');
    }

    return partner;
  }

  async getSnapshotForSelf(userId: string) {
    const partner = await this.requirePartner(userId);

    return this.getSnapshot(partner.id);
  }

  async getSnapshot(deliveryPartnerId: string) {
    const snapshot = await this.compute(deliveryPartnerId);

    // Only the fields DeliveryComplianceSnapshot actually persists — expiringWithin30Days/
    // expired are derived document lists, not stored on the cache row.
    await this.complianceRepository.upsertSnapshot(deliveryPartnerId, {
      overallStatus: snapshot.overallStatus,
      verificationStage: snapshot.verificationStage,
      documentsTotal: snapshot.documentsTotal,
      documentsVerified: snapshot.documentsVerified,
      documentsPending: snapshot.documentsPending,
      documentsRejected: snapshot.documentsRejected,
      bankVerificationStatus: snapshot.bankVerificationStatus,
      missingDocumentTypes: snapshot.missingDocumentTypes,
    });

    return snapshot;
  }
}
