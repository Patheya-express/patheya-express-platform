import { Injectable } from '@nestjs/common';

import { AuditAction } from '@prisma/client';

import { AuditRepository } from '../repositories/audit.repository';

import { GetAdminAuditLogsQueryDto } from '../dto/get-admin-audit-logs-query.dto';
import { PaginatedAdminAuditLogsResponseDto } from '../dto/paginated-admin-audit-logs-response.dto';
import { AdminAuditLogResponseDto } from '../dto/admin-audit-log-response.dto';

/**
 * Flattens the raw Prisma include shape (user as a full User row) into the documented
 * AdminAuditLogResponseDto shape — this is what keeps passwordHash out of every audit
 * response, legacy or admin-scoped.
 */
function toAdminAuditLog(log: any): AdminAuditLogResponseDto {
  return {
    id: log.id,
    actor: log.user
      ? {
          id: log.user.id,
          firstName: log.user.firstName,
          lastName: log.user.lastName,
          email: log.user.email,
          role: log.user.role,
        }
      : undefined,
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId ?? undefined,
    oldValues: log.oldValues ?? undefined,
    newValues: log.newValues ?? undefined,
    ipAddress: log.ipAddress ?? undefined,
    userAgent: log.userAgent ?? undefined,
    createdAt: log.createdAt,
  };
}

@Injectable()
export class AuditService {
  constructor(private readonly auditRepository: AuditRepository) {}

  async log(
    userId: string | null,

    entityType: string,

    entityId: string | null,

    action: AuditAction,

    oldValues?: any,

    newValues?: any,
  ) {
    return this.auditRepository.createLog({
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
  ): Promise<AdminAuditLogResponseDto[]> {
    const logs = await this.auditRepository.findLogs(page, limit);

    return logs.map(toAdminAuditLog);
  }

  async getAllForAdmin(query: GetAdminAuditLogsQueryDto): Promise<PaginatedAdminAuditLogsResponseDto> {
    const skip = (query.page - 1) * query.limit;

    const { items, total } = await this.auditRepository.findAllForAdmin({
      search: query.search,
      action: query.action,
      entityType: query.entityType,
      userId: query.userId,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      skip,
      take: query.limit,
    });

    return {
      items: items.map(toAdminAuditLog),

      total,

      page: query.page,

      limit: query.limit,

      totalPages: Math.ceil(total / query.limit),
    };
  }
}
