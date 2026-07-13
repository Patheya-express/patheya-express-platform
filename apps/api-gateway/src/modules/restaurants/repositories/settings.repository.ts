import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import { BaseRepository } from '../../../infrastructure/database/repositories/base.repository';

/** Schema @default values, mirrored here so a restaurant that has never saved a settings row
 *  can still be shown a fully-populated, correct-looking settings response on first GET. */
const DEFAULTS = {
  serviceChargeType: 'NONE' as const,
  serviceChargeValue: 0,
  packingChargeType: 'NONE' as const,
  packingChargeValue: 0,
  minimumOrderAmount: 0,
  currency: 'INR',
  autoAcceptOrders: false,
  acceptanceTimeoutMinutes: 10,
  isTemporarilyClosed: false,
  notifyOnNewOrder: true,
  notifyOnOrderCancelled: true,
  notifyOnRefund: true,
  notifyOnCustomerMessage: true,
};

@Injectable()
export class SettingsRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async findByRestaurant(restaurantId: string) {
    const settings = await this.prisma.restaurantSettings.findUnique({
      where: { restaurantId },
    });

    return settings ?? { restaurantId, ...DEFAULTS };
  }

  async upsert(restaurantId: string, data: Record<string, unknown>) {
    return this.prisma.restaurantSettings.upsert({
      where: { restaurantId },
      create: { restaurantId, ...DEFAULTS, ...data },
      update: data,
    });
  }
}
