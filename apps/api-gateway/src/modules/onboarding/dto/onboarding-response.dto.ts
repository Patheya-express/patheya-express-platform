import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { OnboardingStatus } from '@prisma/client';

import { OnboardingChangeItemDto } from './request-onboarding-changes.dto';

export const ONBOARDING_TOTAL_STEPS = 12;

export class OnboardingResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() restaurantId: string;
  @ApiProperty({ enum: OnboardingStatus }) status: OnboardingStatus;
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
  @ApiPropertyOptional({ type: [OnboardingChangeItemDto] })
  changesRequested?: OnboardingChangeItemDto[];
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}
