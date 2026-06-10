import {
    Injectable,
  } from '@nestjs/common';
  
  import { PrismaService }
  from '../../../infrastructure/database/prisma.service';
  
  @Injectable()
  export class AuditRepository {
  
    constructor(
      private readonly prisma:
        PrismaService,
    ) {}
  
    async createLog(
      data: any,
    ) {
  
      return this.prisma.auditLog
        .create({
  
          data,
  
        });
  
    }
  
    async findLogs(
  
      page: number,
  
      limit: number,
  
    ) {
  
      return this.prisma.auditLog
        .findMany({
  
          skip:
            (page - 1) * limit,
  
          take:
            limit,
  
          orderBy: {
  
            createdAt:
              'desc',
  
          },
  
          include: {
  
            user: true,
  
          },
  
        });
  
    }
  
  }