import { ApiProperty } from '@nestjs/swagger';

import { AdminAuditLogResponseDto } from './admin-audit-log-response.dto';

export class PaginatedAdminAuditLogsResponseDto {
  @ApiProperty({
    type: AdminAuditLogResponseDto,
    isArray: true,
  })
  items: AdminAuditLogResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;

  @ApiProperty()
  totalPages: number;
}
