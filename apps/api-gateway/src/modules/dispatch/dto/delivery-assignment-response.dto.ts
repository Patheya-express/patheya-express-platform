import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { AssignmentStatus } from '@prisma/client';

import { AssignmentOrderSummaryDto } from './assignment-order-summary.dto';

export class DeliveryAssignmentResponseDto {
  @ApiProperty({
    example: 'c7c1f1e2-6f2d-4f77-a111-123456789abc',
  })
  id: string;

  @ApiProperty({
    example: 'c7c1f1e2-6f2d-4f77-a111-123456789abc',
  })
  orderId: string;

  @ApiProperty({
    example: 'c7c1f1e2-6f2d-4f77-a111-123456789abc',
  })
  deliveryPartnerId: string;

  @ApiProperty({
    enum: AssignmentStatus,
  })
  status: AssignmentStatus;

  @ApiProperty({
    example: '2026-05-29T10:00:00.000Z',
  })
  assignedAt: Date;

  @ApiPropertyOptional({
    example: '2026-05-29T10:02:00.000Z',
  })
  respondedAt?: Date;

  @ApiPropertyOptional({
    example: '2026-05-29T10:10:00.000Z',
  })
  expiresAt?: Date;

  @ApiProperty({
    example: '2026-05-29T10:00:00.000Z',
  })
  createdAt: Date;

  @ApiProperty({
    example: '2026-05-29T10:00:00.000Z',
  })
  updatedAt: Date;

  @ApiPropertyOptional({
    type: () => AssignmentOrderSummaryDto,
  })
  order?: AssignmentOrderSummaryDto;
}
