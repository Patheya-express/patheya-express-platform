import {
    Injectable,
  } from '@nestjs/common';
  
  import {
    AuditAction,
  } from '@prisma/client';
  
  import { AuditRepository }
  from '../repositories/audit.repository';
  
  @Injectable()
  export class AuditService {
  
    constructor(
  
      private readonly auditRepository:
        AuditRepository,
  
    ) {}
  
    async log(
  
      userId: string | null,
  
      entityType: string,
  
      entityId: string | null,
  
      action: AuditAction,
  
      oldValues?: any,
  
      newValues?: any,
  
    ) {
  
      return this.auditRepository
        .createLog({
  
          userId,
  
          entityType,
  
          entityId,
  
          action,
  
          oldValues,
  
          newValues,
  
        });
  
    }
  
    async getLogs(
  
      page = 1,
  
      limit = 20,
  
    ) {
  
      return this.auditRepository
        .findLogs(
          page,
          limit,
        );
  
    }
  
  }