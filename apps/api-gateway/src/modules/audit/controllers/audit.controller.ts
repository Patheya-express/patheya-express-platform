import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiOkResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { UserRole, AuditAction } from '@prisma/client';

import { AuditService } from '../services/audit.service';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';

import { AdminAuditLogResponseDto } from '../dto/admin-audit-log-response.dto';
import { GetAdminAuditLogsQueryDto } from '../dto/get-admin-audit-logs-query.dto';
import { PaginatedAdminAuditLogsResponseDto } from '../dto/paginated-admin-audit-logs-response.dto';

@ApiTags('Audit')
@ApiBearerAuth('JWT-auth')
@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @ApiOperation({
    summary: 'Get audit logs (legacy)',
    description:
      'Returns paginated audit logs ordered by newest first. Superseded by GET /audit/admin, which adds filtering; kept for backward compatibility and secured identically.',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    example: 1,
    description: 'Page number',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    example: 20,
    description: 'Number of records per page',
  })
  @ApiOkResponse({
    description: 'Audit logs fetched successfully',
    type: AdminAuditLogResponseDto,
    isArray: true,
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Get()
  getLogs(
    @Query('page')
    page = 1,

    @Query('limit')
    limit = 20,
  ) {
    return this.auditService.getLogs(
      Number(page),

      Number(limit),
    );
  }

  @ApiOperation({
    summary: 'Get audit logs (admin)',
    description:
      'Returns a paginated, filterable, platform-wide list of audit logs, including actor, entity, and before/after values.',
  })
  @ApiOkResponse({
    description: 'Audit logs retrieved successfully',
    type: PaginatedAdminAuditLogsResponseDto,
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
  })
  @ApiQuery({
    name: 'search',
    required: false,
    description: 'Matches entity type/ID or actor name/email',
  })
  @ApiQuery({
    name: 'action',
    required: false,
    enum: AuditAction,
  })
  @ApiQuery({
    name: 'entityType',
    required: false,
  })
  @ApiQuery({
    name: 'userId',
    required: false,
  })
  @ApiQuery({
    name: 'dateFrom',
    required: false,
  })
  @ApiQuery({
    name: 'dateTo',
    required: false,
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Get('admin')
  getAllForAdmin(
    @Query()
    query: GetAdminAuditLogsQueryDto,
  ) {
    return this.auditService.getAllForAdmin(query);
  }
}
