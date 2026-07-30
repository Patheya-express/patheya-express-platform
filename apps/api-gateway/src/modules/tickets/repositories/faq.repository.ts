import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

@Injectable()
export class FaqRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findActive(category?: string) {
    return this.prisma.fAQ.findMany({
      where: { isActive: true, ...(category ? { category } : {}) },
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
    });
  }

  async findAllForAdmin() {
    return this.prisma.fAQ.findMany({
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
    });
  }

  async findById(id: string) {
    return this.prisma.fAQ.findUnique({ where: { id } });
  }

  async create(data: {
    category: string;
    question: string;
    answer: string;
    sortOrder?: number;
  }) {
    return this.prisma.fAQ.create({ data });
  }

  async update(
    id: string,
    data: Partial<{
      category: string;
      question: string;
      answer: string;
      sortOrder: number;
      isActive: boolean;
    }>,
  ) {
    return this.prisma.fAQ.update({ where: { id }, data });
  }

  async delete(id: string) {
    return this.prisma.fAQ.delete({ where: { id } });
  }
}
