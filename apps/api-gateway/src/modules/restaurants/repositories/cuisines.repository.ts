import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

@Injectable()
export class CuisinesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.cuisine.findMany({
      orderBy: {
        name: 'asc',
      },
    });
  }
}
