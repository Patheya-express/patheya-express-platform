import { Injectable } from '@nestjs/common';

import { RestaurantMediaType } from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import { BaseRepository } from '../../../infrastructure/database/repositories/base.repository';

@Injectable()
export class MediaRepository extends BaseRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async findManyByRestaurant(restaurantId: string) {
    return this.prisma.restaurantMedia.findMany({
      where: { restaurantId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async findById(mediaId: string) {
    return this.prisma.restaurantMedia.findUnique({ where: { id: mediaId } });
  }

  async create(data: {
    restaurantId: string;
    branchId?: string;
    type: RestaurantMediaType;
    url: string;
    uploadedById: string;
    sortOrder: number;
  }) {
    return this.prisma.restaurantMedia.create({ data });
  }

  async delete(mediaId: string) {
    return this.prisma.restaurantMedia.delete({ where: { id: mediaId } });
  }

  async countByRestaurant(restaurantId: string): Promise<number> {
    return this.prisma.restaurantMedia.count({ where: { restaurantId } });
  }

  async reorder(items: { id: string; sortOrder: number }[]) {
    return this.prisma.$transaction(
      items.map((item) =>
        this.prisma.restaurantMedia.update({
          where: { id: item.id },
          data: { sortOrder: item.sortOrder },
        }),
      ),
    );
  }
}
