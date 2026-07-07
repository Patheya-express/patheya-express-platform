import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { UserRole } from '@prisma/client';

export class AdminAuditActorSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  firstName: string;

  @ApiPropertyOptional()
  lastName?: string;

  @ApiPropertyOptional()
  email?: string;

  @ApiProperty({
    enum: UserRole,
  })
  role: UserRole;
}
