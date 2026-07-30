import { Injectable, NotFoundException } from '@nestjs/common';

import { ConfigService } from '@nestjs/config';

import { AuditAction } from '@prisma/client';

import { DeliveryRepository } from '../repositories/delivery.repository';
import { BankAccountRepository } from '../repositories/bank-account.repository';

import { UpsertDeliveryBankAccountDto } from '../dto/upsert-delivery-bank-account.dto';

import { encryptSecret, maskLast4 } from '../../../shared/crypto/crypto.util';

import { AuditService } from '../../audit/services/audit.service';
import { EventBusService } from '../../../core/events/event-bus.service';

@Injectable()
export class BankAccountService {
  constructor(
    private readonly deliveryRepository: DeliveryRepository,
    private readonly bankAccountRepository: BankAccountRepository,
    private readonly auditService: AuditService,
    private readonly config: ConfigService,
    private readonly eventBus: EventBusService,
  ) {}

  private async requirePartner(userId: string) {
    const partner = await this.deliveryRepository.findPartnerByUserId(userId);

    if (!partner) {
      throw new NotFoundException('Delivery partner not found');
    }

    return partner;
  }

  async findForSelf(userId: string) {
    const partner = await this.requirePartner(userId);

    return this.bankAccountRepository.findByPartner(partner.id);
  }

  async upsert(userId: string, dto: UpsertDeliveryBankAccountDto) {
    const partner = await this.requirePartner(userId);

    const encryptionKey = this.config.get<string>(
      'security.bankAccountEncryptionKey',
      '',
    );

    const account = await this.bankAccountRepository.upsert(partner.id, {
      accountHolderName: dto.accountHolderName,
      bankName: dto.bankName,
      branchName: dto.branchName,
      accountNumberEncrypted: encryptSecret(dto.accountNumber, encryptionKey),
      accountNumberLast4: maskLast4(dto.accountNumber),
      ifsc: dto.ifsc,
      upiId: dto.upiId,
      cancelledChequeDocumentId: dto.cancelledChequeDocumentId,
    });

    // Never log the account number itself, even masked, in oldValues/newValues.
    await this.auditService.log(
      userId,
      'DeliveryBankAccount',
      partner.id,
      AuditAction.UPDATE,
      null,
      { bankName: dto.bankName, ifsc: dto.ifsc },
    );

    return account;
  }

  /** Admin-only. */
  async verify(deliveryPartnerId: string, adminUserId: string) {
    const account = await this.bankAccountRepository.markVerified(
      deliveryPartnerId,
      adminUserId,
    );

    await this.auditService.log(
      adminUserId,
      'DeliveryBankAccount',
      deliveryPartnerId,
      AuditAction.APPROVE,
      null,
      { status: 'VERIFIED' },
    );

    await this.eventBus.publish('delivery.bank.verified', {
      deliveryPartnerId,
    });

    return account;
  }

  /** Admin-only. */
  async reject(deliveryPartnerId: string, adminUserId: string) {
    const account =
      await this.bankAccountRepository.markRejected(deliveryPartnerId);

    await this.auditService.log(
      adminUserId,
      'DeliveryBankAccount',
      deliveryPartnerId,
      AuditAction.REJECT,
      null,
      { status: 'REJECTED' },
    );

    return account;
  }
}
