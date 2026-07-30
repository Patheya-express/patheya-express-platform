import { ForbiddenException, Injectable } from '@nestjs/common';

import { VerificationStatus } from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import { DocumentsRepository } from '../repositories/documents.repository';
import { VerificationRepository } from '../repositories/verification.repository';
import { TaxProfileRepository } from '../repositories/tax-profile.repository';
import { BankAccountRepository } from '../repositories/bank-account.repository';

import { ComplianceResponseDto } from '../dto/compliance-response.dto';

import {
  AuthenticatedUser,
  canAccessRestaurant,
} from '../../../shared/authorization/order-access.util';

const EXPIRY_WINDOW_DAYS = 30;

@Injectable()
export class ComplianceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documentsRepository: DocumentsRepository,
    private readonly verificationRepository: VerificationRepository,
    private readonly taxProfileRepository: TaxProfileRepository,
    private readonly bankAccountRepository: BankAccountRepository,
  ) {}

  async getSnapshot(
    restaurantId: string,
    user: AuthenticatedUser,
  ): Promise<ComplianceResponseDto> {
    if (!(await canAccessRestaurant(this.prisma, restaurantId, user))) {
      throw new ForbiddenException('You do not have access to this restaurant');
    }

    const [verification, documents, taxProfile, bankAccount] =
      await Promise.all([
        this.verificationRepository.findOrCreate(restaurantId),
        this.documentsRepository.findLatestByRestaurant(restaurantId),
        this.taxProfileRepository.findByRestaurant(restaurantId),
        this.bankAccountRepository.findByRestaurant(restaurantId),
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

    const hasBlockingIssue =
      verification.stage === 'REJECTED' ||
      verification.stage === 'SUSPENDED' ||
      documentsRejected > 0 ||
      bankAccount?.verificationStatus === VerificationStatus.REJECTED ||
      taxProfile?.gstVerificationStatus === VerificationStatus.REJECTED ||
      taxProfile?.fssaiVerificationStatus === VerificationStatus.REJECTED;

    const hasRisk =
      expired.length > 0 ||
      expiringWithin30Days.length > 0 ||
      documentsPending > 0 ||
      verification.stage !== 'APPROVED';

    const overallStatus: ComplianceResponseDto['overallStatus'] =
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
      gstVerificationStatus: taxProfile?.gstVerificationStatus,
      fssaiVerificationStatus: taxProfile?.fssaiVerificationStatus,
      bankVerificationStatus: bankAccount?.verificationStatus,
    };
  }
}
