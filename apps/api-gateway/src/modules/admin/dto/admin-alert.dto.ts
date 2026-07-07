import { ApiProperty } from '@nestjs/swagger';

export type AdminAlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export class AdminAlertDto {
  @ApiProperty({
    example: 'c7c1f1e2-6f2d-4f77-a111-123456789abc',
  })
  id: string;

  @ApiProperty({
    example: 'WARNING',
    enum: ['INFO', 'WARNING', 'CRITICAL'],
  })
  severity: AdminAlertSeverity;

  @ApiProperty({
    example: 'Payment reconciliation job is running behind schedule',
  })
  message: string;

  @ApiProperty({
    example: '2026-07-04T10:00:00.000Z',
  })
  createdAt: string;
}
