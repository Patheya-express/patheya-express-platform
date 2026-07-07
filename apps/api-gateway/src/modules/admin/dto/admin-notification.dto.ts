import { ApiProperty } from '@nestjs/swagger';

export class AdminNotificationDto {
  @ApiProperty({
    example: 'c7c1f1e2-6f2d-4f77-a111-123456789abc',
  })
  id: string;

  @ApiProperty({
    example: 'A new restaurant application is awaiting approval',
  })
  message: string;

  @ApiProperty({
    example: false,
  })
  isRead: boolean;

  @ApiProperty({
    example: '2026-07-04T10:00:00.000Z',
  })
  createdAt: string;
}
