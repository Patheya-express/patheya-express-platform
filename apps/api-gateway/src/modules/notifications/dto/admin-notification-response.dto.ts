import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { NotificationChannel, NotificationStatus, NotificationType } from '@prisma/client';

import { AdminNotificationRecipientSummaryDto } from './admin-notification-recipient-summary.dto';

/**
 * A parallel, admin-facing notification projection — distinct from NotificationResponseDto
 * (the self-service /notifications/me contract) so that admin-only fields (attempts,
 * errorMessage, recipient) don't leak onto the user-facing endpoint.
 */
export class AdminNotificationResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({
    enum: NotificationType,
  })
  type: NotificationType;

  @ApiProperty({
    enum: NotificationChannel,
  })
  channel: NotificationChannel;

  @ApiProperty({
    type: AdminNotificationRecipientSummaryDto,
  })
  recipient: AdminNotificationRecipientSummaryDto;

  @ApiProperty({
    description: 'Persisted as `title` — displayed to admins as "Subject".',
  })
  title: string;

  @ApiProperty()
  message: string;

  @ApiProperty({
    enum: NotificationStatus,
  })
  status: NotificationStatus;

  @ApiProperty()
  attempts: number;

  @ApiPropertyOptional()
  errorMessage?: string;

  @ApiPropertyOptional({
    description: 'State captured at creation time, if any.',
  })
  metadata?: unknown;

  @ApiPropertyOptional()
  sentAt?: Date;

  @ApiPropertyOptional()
  readAt?: Date;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
