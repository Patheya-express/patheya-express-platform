import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { AuditAction } from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import { HolidaysRepository } from '../repositories/holidays.repository';

import { CreateHolidayDto } from '../dto/create-holiday.dto';
import { UpdateHolidayDto } from '../dto/update-holiday.dto';

import { AuditService } from '../../audit/services/audit.service';
import { RealtimeService } from '../../realtime/services/realtime.service';
import {
  AuthenticatedUser,
  hasRestaurantRole,
} from '../../../shared/authorization/order-access.util';

const MANAGE_ROLES = ['OWNER', 'CO_OWNER', 'BRANCH_MANAGER', 'ADMIN'] as const;

@Injectable()
export class HolidaysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly holidaysRepository: HolidaysRepository,
    private readonly auditService: AuditService,
    private readonly realtimeService: RealtimeService,
  ) {}

  async findAll(restaurantId: string, branchId?: string) {
    return this.holidaysRepository.findAll(restaurantId, branchId);
  }

  async create(
    restaurantId: string,
    dto: CreateHolidayDto,
    user: AuthenticatedUser,
  ) {
    await this.assertCanManage(restaurantId, user);
    this.assertValidHoursShape(dto);

    if (dto.branchId) {
      await this.requireBranch(restaurantId, dto.branchId);
    }

    const holiday = await this.holidaysRepository.create(restaurantId, {
      date: new Date(dto.date),
      name: dto.name,
      branchId: dto.branchId,
      isClosed: dto.isClosed ?? true,
      specialOpensAt: dto.specialOpensAt,
      specialClosesAt: dto.specialClosesAt,
    });

    await this.auditService.log(
      user.userId,
      'RestaurantHoliday',
      holiday.id,
      AuditAction.CREATE,
      null,
      { restaurantId, date: dto.date, name: dto.name },
    );

    this.realtimeService.emitToRestaurant(
      restaurantId,
      'restaurant.holiday.created',
      {
        restaurantId,
        holidayId: holiday.id,
      },
    );

    return holiday;
  }

  async update(
    restaurantId: string,
    holidayId: string,
    dto: UpdateHolidayDto,
    user: AuthenticatedUser,
  ) {
    await this.assertCanManage(restaurantId, user);
    await this.requireHoliday(restaurantId, holidayId);
    this.assertValidHoursShape(dto);

    const updated = await this.holidaysRepository.update(holidayId, {
      ...(dto.date ? { date: new Date(dto.date) } : {}),
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.isClosed !== undefined ? { isClosed: dto.isClosed } : {}),
      ...(dto.specialOpensAt !== undefined
        ? { specialOpensAt: dto.specialOpensAt }
        : {}),
      ...(dto.specialClosesAt !== undefined
        ? { specialClosesAt: dto.specialClosesAt }
        : {}),
    });

    await this.auditService.log(
      user.userId,
      'RestaurantHoliday',
      holidayId,
      AuditAction.UPDATE,
      null,
      dto,
    );

    return updated;
  }

  async remove(
    restaurantId: string,
    holidayId: string,
    user: AuthenticatedUser,
  ) {
    await this.assertCanManage(restaurantId, user);
    await this.requireHoliday(restaurantId, holidayId);

    const removed = await this.holidaysRepository.remove(holidayId);

    await this.auditService.log(
      user.userId,
      'RestaurantHoliday',
      holidayId,
      AuditAction.DELETE,
      null,
      null,
    );

    return removed;
  }

  private assertValidHoursShape(dto: {
    isClosed?: boolean;
    specialOpensAt?: string;
    specialClosesAt?: string;
  }) {
    if (
      dto.isClosed === false &&
      (!dto.specialOpensAt || !dto.specialClosesAt)
    ) {
      throw new BadRequestException(
        'specialOpensAt and specialClosesAt are required when isClosed is false',
      );
    }
  }

  private async assertCanManage(restaurantId: string, user: AuthenticatedUser) {
    if (
      !(await hasRestaurantRole(this.prisma, restaurantId, user, [
        ...MANAGE_ROLES,
      ]))
    ) {
      throw new ForbiddenException(
        'You do not have permission to manage this restaurant’s holiday calendar',
      );
    }
  }

  private async requireBranch(restaurantId: string, branchId: string) {
    const branch = await this.prisma.restaurantBranch.findUnique({
      where: { id: branchId },
      select: { restaurantId: true },
    });

    if (!branch || branch.restaurantId !== restaurantId) {
      throw new NotFoundException('Branch not found');
    }
  }

  private async requireHoliday(restaurantId: string, holidayId: string) {
    const holiday = await this.holidaysRepository.findById(holidayId);

    if (!holiday || holiday.restaurantId !== restaurantId) {
      throw new NotFoundException('Holiday not found');
    }

    return holiday;
  }
}
