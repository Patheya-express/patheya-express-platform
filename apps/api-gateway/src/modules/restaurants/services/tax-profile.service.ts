import { ForbiddenException, Injectable } from '@nestjs/common';

import { AuditAction } from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import { TaxProfileRepository } from '../repositories/tax-profile.repository';

import { UpsertTaxProfileDto } from '../dto/upsert-tax-profile.dto';

import { AuditService } from '../../audit/services/audit.service';
import {
  AuthenticatedUser,
  canAccessRestaurant,
  hasRestaurantRole,
} from '../../../shared/authorization/order-access.util';

const MANAGE_ROLES = ['OWNER', 'CO_OWNER', 'FINANCE_MANAGER', 'ADMIN'] as const;

@Injectable()
export class TaxProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly taxProfileRepository: TaxProfileRepository,
    private readonly auditService: AuditService,
  ) {}

  async find(restaurantId: string, user: AuthenticatedUser) {
    if (!(await canAccessRestaurant(this.prisma, restaurantId, user))) {
      throw new ForbiddenException('You do not have access to this restaurant');
    }

    return this.taxProfileRepository.findByRestaurant(restaurantId);
  }

  async upsert(
    restaurantId: string,
    dto: UpsertTaxProfileDto,
    user: AuthenticatedUser,
  ) {
    if (
      !(await hasRestaurantRole(this.prisma, restaurantId, user, [
        ...MANAGE_ROLES,
      ]))
    ) {
      throw new ForbiddenException(
        'You do not have permission to manage this restaurant’s tax profile',
      );
    }

    const profile = await this.taxProfileRepository.upsert(restaurantId, dto);

    await this.auditService.log(
      user.userId,
      'RestaurantTaxProfile',
      restaurantId,
      AuditAction.UPDATE,
      null,
      { gstin: dto.gstin, fssaiNumber: dto.fssaiNumber },
    );

    return profile;
  }

  async verifyGst(restaurantId: string, user: AuthenticatedUser) {
    const profile = await this.taxProfileRepository.markGstVerified(
      restaurantId,
      user.userId,
    );

    await this.auditService.log(
      user.userId,
      'RestaurantTaxProfile',
      restaurantId,
      AuditAction.APPROVE,
      null,
      { field: 'gst', status: 'VERIFIED' },
    );

    return profile;
  }

  async rejectGst(restaurantId: string, user: AuthenticatedUser) {
    const profile =
      await this.taxProfileRepository.markGstRejected(restaurantId);

    await this.auditService.log(
      user.userId,
      'RestaurantTaxProfile',
      restaurantId,
      AuditAction.REJECT,
      null,
      { field: 'gst', status: 'REJECTED' },
    );

    return profile;
  }

  async verifyFssai(restaurantId: string, user: AuthenticatedUser) {
    const profile = await this.taxProfileRepository.markFssaiVerified(
      restaurantId,
      user.userId,
    );

    await this.auditService.log(
      user.userId,
      'RestaurantTaxProfile',
      restaurantId,
      AuditAction.APPROVE,
      null,
      { field: 'fssai', status: 'VERIFIED' },
    );

    return profile;
  }

  async rejectFssai(restaurantId: string, user: AuthenticatedUser) {
    const profile =
      await this.taxProfileRepository.markFssaiRejected(restaurantId);

    await this.auditService.log(
      user.userId,
      'RestaurantTaxProfile',
      restaurantId,
      AuditAction.REJECT,
      null,
      { field: 'fssai', status: 'REJECTED' },
    );

    return profile;
  }
}
