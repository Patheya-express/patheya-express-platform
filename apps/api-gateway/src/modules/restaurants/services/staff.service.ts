import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { AuditAction, RestaurantStaffRole } from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import { StaffRepository } from '../repositories/staff.repository';

import { InviteStaffDto } from '../dto/invite-staff.dto';
import { UpdateStaffDto } from '../dto/update-staff.dto';

import { AuditService } from '../../audit/services/audit.service';
import {
  AuthenticatedUser,
  canAccessRestaurant,
  hasRestaurantRole,
} from '../../../shared/authorization/order-access.util';

const MANAGE_ROLES = ['OWNER', 'CO_OWNER', 'ADMIN'] as const;

@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly staffRepository: StaffRepository,
    private readonly auditService: AuditService,
  ) {}

  async findAll(restaurantId: string, user: AuthenticatedUser) {
    if (!(await canAccessRestaurant(this.prisma, restaurantId, user))) {
      throw new ForbiddenException('You do not have access to this restaurant');
    }

    return this.staffRepository.findManyByRestaurant(restaurantId);
  }

  async invite(
    restaurantId: string,
    dto: InviteStaffDto,
    user: AuthenticatedUser,
  ) {
    if (
      !(await hasRestaurantRole(this.prisma, restaurantId, user, [
        ...MANAGE_ROLES,
      ]))
    ) {
      throw new ForbiddenException(
        'You do not have permission to invite staff to this restaurant',
      );
    }

    if (dto.role === RestaurantStaffRole.OWNER) {
      throw new BadRequestException(
        'OWNER is derived from Restaurant.ownerId and cannot be assigned via staff invites',
      );
    }

    const invitee = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });

    if (!invitee) {
      throw new NotFoundException(
        'No registered user with that email — they must already have a Patheya Express account',
      );
    }

    const existing = await this.staffRepository.findByRestaurantAndUser(
      restaurantId,
      invitee.id,
    );

    if (existing) {
      throw new ConflictException(
        'This user is already staff for this restaurant',
      );
    }

    const staff = await this.staffRepository.create({
      restaurantId,
      userId: invitee.id,
      branchId: dto.branchId,
      role: dto.role,
      invitedById: user.userId,
    });

    await this.auditService.log(
      user.userId,
      'RestaurantStaff',
      staff.id,
      AuditAction.CREATE,
      null,
      { restaurantId, userId: invitee.id, role: dto.role },
    );

    return staff;
  }

  async update(
    restaurantId: string,
    staffId: string,
    dto: UpdateStaffDto,
    user: AuthenticatedUser,
  ) {
    await this.requireStaff(restaurantId, staffId);

    if (
      !(await hasRestaurantRole(this.prisma, restaurantId, user, [
        ...MANAGE_ROLES,
      ]))
    ) {
      throw new ForbiddenException(
        'You do not have permission to manage staff for this restaurant',
      );
    }

    const updated = await this.staffRepository.update(staffId, dto);

    await this.auditService.log(
      user.userId,
      'RestaurantStaff',
      staffId,
      AuditAction.UPDATE,
      null,
      dto,
    );

    return updated;
  }

  async accept(restaurantId: string, staffId: string, user: AuthenticatedUser) {
    const staff = await this.requireStaff(restaurantId, staffId);

    if (staff.userId !== user.userId) {
      throw new ForbiddenException('You can only accept your own invitation');
    }

    const accepted = await this.staffRepository.accept(staffId);

    await this.auditService.log(
      user.userId,
      'RestaurantStaff',
      staffId,
      AuditAction.STATUS_CHANGE,
      { status: staff.status },
      { status: 'ACTIVE' },
    );

    return accepted;
  }

  async revoke(restaurantId: string, staffId: string, user: AuthenticatedUser) {
    await this.requireStaff(restaurantId, staffId);

    if (
      !(await hasRestaurantRole(this.prisma, restaurantId, user, [
        ...MANAGE_ROLES,
      ]))
    ) {
      throw new ForbiddenException(
        'You do not have permission to remove staff from this restaurant',
      );
    }

    const revoked = await this.staffRepository.revoke(staffId);

    await this.auditService.log(
      user.userId,
      'RestaurantStaff',
      staffId,
      AuditAction.STATUS_CHANGE,
      null,
      { status: 'REVOKED' },
    );

    return revoked;
  }

  private async requireStaff(restaurantId: string, staffId: string) {
    const staff = await this.staffRepository.findById(staffId);

    if (!staff || staff.restaurantId !== restaurantId) {
      throw new NotFoundException('Staff member not found');
    }

    return staff;
  }
}
