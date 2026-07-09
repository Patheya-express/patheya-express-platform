import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

@Injectable()
export class CuisinesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(search?: string) {
    return this.prisma.cuisine.findMany({
      where: search
        ? { name: { contains: search, mode: 'insensitive' } }
        : undefined,

      orderBy: {
        name: 'asc',
      },
    });
  }
}
