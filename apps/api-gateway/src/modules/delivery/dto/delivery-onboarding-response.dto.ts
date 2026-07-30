import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { DeliveryOnboardingStatus } from '@prisma/client';

import { DeliveryOnboardingChangeItemDto } from './request-delivery-onboarding-changes.dto';

/**
 * 1 Personal, 2 Address, 3 Vehicle, 4 Driving License, 5 Aadhaar, 6 PAN, 7 RC, 8 Insurance,
 * 9 Bank, 10 Selfie, 11 Background Verification, 12 Review (submit act itself).
 */
export const DELIVERY_ONBOARDING_TOTAL_STEPS = 12;

export class DeliveryOnboardingResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() deliveryPartnerId: string;
  @ApiProperty({ enum: DeliveryOnboardingStatus })
  status: DeliveryOnboardingStatus;
  @ApiProperty({ example: 4 }) currentStep: number;
  @ApiProperty({ type: [Number] }) completedSteps: number[];
  @ApiProperty({
    example: 33,
    description: 'completedSteps.length / 12, rounded.',
  })
  progressPercent: number;
  @ApiPropertyOptional() termsAcceptedAt?: Date;
  @ApiPropertyOptional() submittedAt?: Date;
  @ApiPropertyOptional() decidedAt?: Date;
  @ApiPropertyOptional({ type: [DeliveryOnboardingChangeItemDto] })
  changesRequested?: DeliveryOnboardingChangeItemDto[];
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}
