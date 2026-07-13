import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import { BaseRepository } from '../../../infrastructure/database/repositories/base.repository';

import { UpsertOperatingHourDto } from '../dto/upsert-operating-hour.dto';

@Injectable()
export class OperatingHoursRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async findByBranch(branchId: string) {
    return this.prisma.operatingHour.findMany({
      where: { branchId },
      orderBy: [{ dayOfWeek: 'asc' }, { opensAt: 'asc' }],
    });
  }

  /**
   * Replaces the branch's entire weekly schedule in one transaction — simpler and less
   * error-prone than diffing individual rows, and matches how the frontend edits a whole-week
   * schedule form at once.
   */
  async replaceAll(branchId: string, hours: UpsertOperatingHourDto[]) {
    return this.prisma.$transaction(async (tx) => {
      await tx.operatingHour.deleteMany({ where: { branchId } });

      if (hours.length === 0) {
        return [];
      }

      await tx.operatingHour.createMany({
        data: hours.map((hour) => ({
          branchId,
          dayOfWeek: hour.dayOfWeek,
          opensAt: hour.opensAt,
          closesAt: hour.closesAt,
          isClosed: hour.isClosed ?? false,
        })),
      });

      return tx.operatingHour.findMany({
        where: { branchId },
        orderBy: [{ dayOfWeek: 'asc' }, { opensAt: 'asc' }],
      });
    });
  }
}
