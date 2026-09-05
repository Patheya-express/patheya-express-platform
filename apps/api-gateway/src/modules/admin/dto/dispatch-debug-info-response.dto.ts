import { ApiProperty } from '@nestjs/swagger';

/**
 * Enterprise Dispatch Engine Enhancement — Phase 3 (Change 6, admin visibility). Debugging/
 * support-only surface — a snapshot of an order's dispatch state derived entirely from its
 * existing DeliveryAssignment history, computed the same way DispatchService.assignOrder()
 * itself derives cycle state. No frontend consumes this; it exists for support engineers
 * debugging "why hasn't this order been picked up" without needing direct DB/log access.
 *
 * Dispatch Simplification — no `cooldownPartners` field: rejection cooldown was removed from
 * the dispatch pipeline entirely.
 */
export class DispatchDebugInfoResponseDto {
  @ApiProperty({ example: 'c7c1f1e2-6f2d-4f77-a111-123456789abc' })
  orderId: string;

  @ApiProperty({
    example: 2,
    description:
      "Highest cycle number reached so far, derived the same way DispatchService.assignOrder() derives it (max cycle across this order's DeliveryAssignment rows, defaulting to 1 if none exist yet).",
  })
  currentCycle: number;

  @ApiProperty({
    example: 5,
    description:
      'Total DeliveryAssignment rows ever created for this order, across every cycle.',
  })
  attemptCount: number;

  @ApiProperty({
    example: '2026-08-06T10:15:00.000Z',
    nullable: true,
    description:
      'assignedAt of the most recent attempt, or null if this order has never been offered to anyone.',
  })
  lastAttemptAt: Date | null;

  @ApiProperty({
    type: [String],
    description:
      'DeliveryPartner ids offered this order that did not result in an acceptance (REJECTED or EXPIRED), across every cycle — a historical view, not a live re-check of current eligibility.',
  })
  partnersSkipped: string[];
}
