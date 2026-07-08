import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { AuditAction } from '@prisma/client';

import { AdminAuditActorSummaryDto } from './admin-audit-actor-summary.dto';

/**
 * A parallel, admin-facing audit log projection — never serializes the raw Prisma `User`
 * relation, so passwordHash can never leak through this or the legacy /audit endpoint.
 */
export class AdminAuditLogResponseDto {
  @ApiProperty()
  id: string;

  @ApiPropertyOptional({
    type: AdminAuditActorSummaryDto,
    description:
      'The user who performed the action. Absent for system-initiated events with no actor.',
  })
  actor?: AdminAuditActorSummaryDto;

  @ApiProperty({
    enum: AuditAction,
  })
  action: AuditAction;

  @ApiProperty()
  entityType: string;

  @ApiPropertyOptional()
  entityId?: string;

  @ApiPropertyOptional({
    description: 'State of the entity before the action, if captured.',
  })
  oldValues?: unknown;

  @ApiPropertyOptional({
    description: 'State of the entity after the action, if captured.',
  })
  newValues?: unknown;

  @ApiPropertyOptional({
    description: 'Not currently populated by any caller — always null today.',
  })
  ipAddress?: string;

  @ApiPropertyOptional({
    description: 'Not currently populated by any caller — always null today.',
  })
  userAgent?: string;

  @ApiProperty()
  createdAt: Date;
}
