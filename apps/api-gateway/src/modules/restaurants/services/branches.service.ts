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

import { BranchesRepository } from '../repositories/branches.repository';

import { CreateBranchDto } from '../dto/create-branch.dto';
import { UpdateBranchDto } from '../dto/update-branch.dto';

import { AuditService } from '../../audit/services/audit.service';
import { EventBusService } from '../../../core/events/event-bus.service';
import {
  AuthenticatedUser,
  hasRestaurantRole,
} from '../../../shared/authorization/order-access.util';

const MANAGE_ROLES = ['OWNER', 'CO_OWNER', 'ADMIN'] as const;

@Injectable()
export class BranchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchesRepository: BranchesRepository,
    private readonly auditService: AuditService,
    private readonly eventBus: EventBusService,
  ) {}

  async findAll(restaurantId: string) {
    return this.branchesRepository.findManyByRestaurant(restaurantId);
  }

  async create(
    restaurantId: string,
    dto: CreateBranchDto,
    user: AuthenticatedUser,
  ) {
    if (
      !(await hasRestaurantRole(this.prisma, restaurantId, user, [
        ...MANAGE_ROLES,
      ]))
    ) {
      throw new ForbiddenException(
        'You do not have permission to add branches to this restaurant',
      );
    }

    const existingCount =
      await this.branchesRepository.countByRestaurant(restaurantId);
    const isFirstBranch = existingCount === 0;

    if (isFirstBranch || dto.isPrimary) {
      await this.branchesRepository.clearPrimary(restaurantId);
    }

    const branch = await this.branchesRepository.create(restaurantId, {
      ...dto,
      isPrimary: isFirstBranch ? true : (dto.isPrimary ?? false),
    });

    await this.auditService.log(
      user.userId,
      'RestaurantBranch',
      branch.id,
      AuditAction.CREATE,
      null,
      { name: branch.name, restaurantId },
    );

    await this.eventBus.publish('restaurant.branch.created', {
      restaurantId,
      branchId: branch.id,
      isPrimary: branch.isPrimary,
    });

    return branch;
  }

  async update(
    restaurantId: string,
    branchId: string,
    dto: UpdateBranchDto,
    user: AuthenticatedUser,
  ) {
    await this.requireBranch(restaurantId, branchId);

    if (!(await this.canManageBranch(restaurantId, branchId, user))) {
      throw new ForbiddenException(
        'You do not have permission to update this branch',
      );
    }

    if (dto.isPrimary) {
      await this.branchesRepository.clearPrimary(restaurantId, branchId);
    }

    const updated = await this.branchesRepository.update(branchId, dto);

    await this.auditService.log(
      user.userId,
      'RestaurantBranch',
      branchId,
      AuditAction.UPDATE,
      null,
      dto,
    );

    return updated;
  }

  async remove(
    restaurantId: string,
    branchId: string,
    user: AuthenticatedUser,
  ) {
    const branch = await this.requireBranch(restaurantId, branchId);

    if (
      !(await hasRestaurantRole(this.prisma, restaurantId, user, [
        ...MANAGE_ROLES,
      ]))
    ) {
      throw new ForbiddenException(
        'You do not have permission to remove this branch',
      );
    }

    const remaining =
      await this.branchesRepository.countByRestaurant(restaurantId);

    if (branch.isPrimary && remaining > 1) {
      throw new ForbiddenException(
        'Set another branch as primary before removing the current primary branch',
      );
    }

    const removed = await this.branchesRepository.softDelete(branchId);

    await this.auditService.log(
      user.userId,
      'RestaurantBranch',
      branchId,
      AuditAction.DELETE,
      { name: branch.name },
      null,
    );

    return removed;
  }

  private async requireBranch(restaurantId: string, branchId: string) {
    const branch = await this.branchesRepository.findById(branchId);

    if (!branch || branch.restaurantId !== restaurantId) {
      throw new NotFoundException('Branch not found');
    }

    return branch;
  }

  /** OWNER/CO_OWNER/ADMIN can manage any branch; BRANCH_MANAGER only the branch they're
   *  assigned to. */
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
