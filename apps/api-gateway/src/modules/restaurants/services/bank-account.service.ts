import { ForbiddenException, Injectable } from '@nestjs/common';

import { ConfigService } from '@nestjs/config';

import { AuditAction } from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import { BankAccountRepository } from '../repositories/bank-account.repository';

import { UpsertBankAccountDto } from '../dto/upsert-bank-account.dto';

import { encryptSecret, maskLast4 } from '../../../shared/crypto/crypto.util';

import { AuditService } from '../../audit/services/audit.service';
import { EventBusService } from '../../../core/events/event-bus.service';
import {
  AuthenticatedUser,
  canAccessRestaurant,
  hasRestaurantRole,
} from '../../../shared/authorization/order-access.util';

/**
 * Deliberately excludes FINANCE_MANAGER, unlike the tax profile — redirecting a restaurant's
 * payout bank account is a classic fraud vector, so only the OWNER/CO_OWNER/ADMIN roles that can
 * also manage staff may change it. FINANCE_MANAGER can still view it via `canAccessRestaurant`.
 */
const MANAGE_ROLES = ['OWNER', 'CO_OWNER', 'ADMIN'] as const;

@Injectable()
export class BankAccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bankAccountRepository: BankAccountRepository,
    private readonly auditService: AuditService,
    private readonly config: ConfigService,
    private readonly eventBus: EventBusService,
  ) {}

  async find(restaurantId: string, user: AuthenticatedUser) {
    if (!(await canAccessRestaurant(this.prisma, restaurantId, user))) {
      throw new ForbiddenException('You do not have access to this restaurant');
    }

    return this.bankAccountRepository.findByRestaurant(restaurantId);
  }

  async upsert(
    restaurantId: string,
    dto: UpsertBankAccountDto,
    user: AuthenticatedUser,
  ) {
    if (
      !(await hasRestaurantRole(this.prisma, restaurantId, user, [
        ...MANAGE_ROLES,
      ]))
    ) {
      throw new ForbiddenException(
        'You do not have permission to manage this restaurant’s bank account',
      );
    }

    const encryptionKey = this.config.get<string>(
      'security.bankAccountEncryptionKey',
      '',
    );

    const account = await this.bankAccountRepository.upsert(restaurantId, {
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
      user.userId,
      'RestaurantBankAccount',
      restaurantId,
      AuditAction.UPDATE,
      null,
      { bankName: dto.bankName, ifsc: dto.ifsc },
    );

    return account;
  }

  async verify(restaurantId: string, user: AuthenticatedUser) {
    const account = await this.bankAccountRepository.markVerified(
      restaurantId,
      user.userId,
    );

    await this.auditService.log(
      user.userId,
      'RestaurantBankAccount',
      restaurantId,
      AuditAction.APPROVE,
      null,
      { status: 'VERIFIED' },
    );

    await this.eventBus.publish('restaurant.bank.verified', { restaurantId });

    return account;
  }

  async reject(restaurantId: string, user: AuthenticatedUser) {
    const account = await this.bankAccountRepository.markRejected(restaurantId);

    await this.auditService.log(
      user.userId,
      'RestaurantBankAccount',
      restaurantId,
      AuditAction.REJECT,
      null,
      { status: 'REJECTED' },
    );

    return account;
  }
}
