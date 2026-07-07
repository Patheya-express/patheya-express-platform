import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { UserStatus } from '@prisma/client';

/** Minimal owner projection — never includes passwordHash or any authentication field. */
export class AdminDeliveryPartnerUserSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  firstName: string;

  @ApiPropertyOptional()
  lastName?: string;

  @ApiPropertyOptional()
  email?: string;

  @ApiPropertyOptional()
  phone?: string;

  @ApiProperty({
    enum: UserStatus,
    description: 'The underlying account status — distinct from DeliveryPartner.status. BLOCKED here means the partner cannot log in at all.',
  })
  status: UserStatus;
}
