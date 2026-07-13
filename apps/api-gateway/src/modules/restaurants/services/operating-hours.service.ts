import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  AuditAction,
  RestaurantStaffRole,
  RestaurantStaffStatus,
} from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import { OperatingHoursRepository } from '../repositories/operating-hours.repository';

import { ReplaceOperatingHoursDto } from '../dto/replace-operating-hours.dto';

import { AuditService } from '../../audit/services/audit.service';
import { RealtimeService } from '../../realtime/services/realtime.service';
import {
  AuthenticatedUser,
  hasRestaurantRole,
} from '../../../shared/authorization/order-access.util';

const MANAGE_ROLES = ['OWNER', 'CO_OWNER', 'ADMIN'] as const;

@Injectable()
export class OperatingHoursService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operatingHoursRepository: OperatingHoursRepository,
    private readonly auditService: AuditService,
    private readonly realtimeService: RealtimeService,
  ) {}

  async findAll(restaurantId: string, branchId: string) {
    await this.requireBranch(restaurantId, branchId);

    return this.operatingHoursRepository.findByBranch(branchId);
  }

  async replaceAll(
    restaurantId: string,
    branchId: string,
    dto: ReplaceOperatingHoursDto,
    user: AuthenticatedUser,
  ) {
    await this.requireBranch(restaurantId, branchId);

    if (!(await this.canManageBranch(restaurantId, branchId, user))) {
      throw new ForbiddenException(
        'You do not have permission to manage this branch’s operating hours',
      );
    }

    const hours = await this.operatingHoursRepository.replaceAll(
      branchId,
      dto.hours,
    );

    await this.auditService.log(
      user.userId,
      'OperatingHour',
      branchId,
      AuditAction.UPDATE,
      null,
      { branchId, entryCount: hours.length },
    );

    this.realtimeService.emitToRestaurant(
      restaurantId,
      'restaurant.hours.updated',
      {
        restaurantId,
        branchId,
      },
    );

    return hours;
  }

  private async requireBranch(restaurantId: string, branchId: string) {
    const branch = await this.prisma.restaurantBranch.findUnique({
      where: { id: branchId },
      select: { id: true, restaurantId: true },
    });

    if (!branch || branch.restaurantId !== restaurantId) {
      throw new NotFoundException('Branch not found');
    }

    return branch;
  }

  /** OWNER/CO_OWNER/ADMIN can manage any branch; BRANCH_MANAGER only the branch they're
   *  assigned to — mirrors BranchesService.canManageBranch. */
  private async canManageBranch(
    restaurantId: string,
    branchId: string,
    user: AuthenticatedUser,
  ): Promise<boolean> {
    if (
      await hasRestaurantRole(this.prisma, restaurantId, user, [
        ...MANAGE_ROLES,
      ])
    ) {
      return true;
    }

    const staff = await this.prisma.restaurantStaff.findFirst({
      where: {
        restaurantId,
        userId: user.userId,
        status: RestaurantStaffStatus.ACTIVE,
        role: RestaurantStaffRole.BRANCH_MANAGER,
        branchId,
      },
      select: { id: true },
    });

    return !!staff;
  }
}
