import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { NotificationChannel, NotificationStatus } from '@prisma/client';

export class NotificationResponseDto {
  @ApiProperty({
    example: 'c7c1f1e2-6f2d-4f77-a111-123456789abc',
  })
  id: string;

  @ApiProperty({
    example: 'c7c1f1e2-6f2d-4f77-a111-123456789abc',
  })
  userId: string;

  @ApiProperty({
    example: 'Order confirmed',
  })
  title: string;

  @ApiProperty({
    example: 'Your order has been confirmed by the restaurant.',
  })
  message: string;

  @ApiProperty({
    enum: NotificationChannel,
  })
  channel: NotificationChannel;

  @ApiProperty({
    enum: NotificationStatus,
  })
  status: NotificationStatus;

  @ApiPropertyOptional({
    example: { orderId: 'c7c1f1e2-6f2d-4f77-a111-123456789abc' },
  })
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional({
    example: '2026-05-29T10:00:00.000Z',
  })
  sentAt?: Date;

  @ApiPropertyOptional({
    example: '2026-05-29T10:05:00.000Z',
  })
  readAt?: Date;

  @ApiProperty({
    example: '2026-05-29T10:00:00.000Z',
  })
  createdAt: Date;
}
