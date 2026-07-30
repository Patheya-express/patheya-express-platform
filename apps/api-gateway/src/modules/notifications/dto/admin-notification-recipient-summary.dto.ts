import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * A parallel, admin-facing recipient projection — never serializes the raw Prisma `User`
 * relation, so passwordHash can never leak through the admin notifications endpoints.
 */
export class AdminNotificationRecipientSummaryDto {
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
}
