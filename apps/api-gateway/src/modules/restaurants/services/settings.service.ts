import { ForbiddenException, Injectable } from '@nestjs/common';

import { AuditAction } from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import { SettingsRepository } from '../repositories/settings.repository';

import { UpsertRestaurantSettingsDto } from '../dto/upsert-restaurant-settings.dto';

import { AuditService } from '../../audit/services/audit.service';
import { RealtimeService } from '../../realtime/services/realtime.service';
import {
  AuthenticatedUser,
  canAccessRestaurant,
  hasRestaurantRole,
} from '../../../shared/authorization/order-access.util';

/** OWNER/CO_OWNER/FINANCE_MANAGER may manage settings — charges and minimum order amount are
 *  finance-adjacent, unlike branch/staff management, so FINANCE_MANAGER is included here even
 *  though it's excluded from BranchesService/BankAccountService's MANAGE_ROLES. */
const MANAGE_ROLES = ['OWNER', 'CO_OWNER', 'FINANCE_MANAGER', 'ADMIN'] as const;

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsRepository: SettingsRepository,
    private readonly auditService: AuditService,
    private readonly realtimeService: RealtimeService,
  ) {}

  async find(restaurantId: string, user: AuthenticatedUser) {
    if (!(await canAccessRestaurant(this.prisma, restaurantId, user))) {
      throw new ForbiddenException('You do not have access to this restaurant');
    }

    return this.settingsRepository.findByRestaurant(restaurantId);
  }

  async upsert(
    restaurantId: string,
    dto: UpsertRestaurantSettingsDto,
    user: AuthenticatedUser,
  ) {
    if (
      !(await hasRestaurantRole(this.prisma, restaurantId, user, [
        ...MANAGE_ROLES,
      ]))
    ) {
      throw new ForbiddenException(
        'You do not have permission to manage this restaurant’s settings',
      );
    }

    const data: Record<string, unknown> = { ...dto };

    if (dto.temporaryClosureUntil !== undefined) {
      data.temporaryClosureUntil = new Date(dto.temporaryClosureUntil);
    }

    const settings = await this.settingsRepository.upsert(restaurantId, data);

    await this.auditService.log(
      user.userId,
      'RestaurantSettings',
      restaurantId,
      AuditAction.UPDATE,
      null,
      dto,
    );

    this.realtimeService.emitToRestaurant(
      restaurantId,
      'restaurant.settings.updated',
      {
        restaurantId,
        isTemporarilyClosed: settings.isTemporarilyClosed,
        autoAcceptOrders: settings.autoAcceptOrders,
      },
    );

    return settings;
  }
}
