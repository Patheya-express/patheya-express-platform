import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { RestaurantVerificationStage } from '@prisma/client';

export class VerificationResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() restaurantId: string;
  @ApiProperty({ enum: RestaurantVerificationStage })
  stage: RestaurantVerificationStage;
  @ApiPropertyOptional() submittedAt?: Date;
  @ApiPropertyOptional() decidedAt?: Date;
  @ApiPropertyOptional() rejectedReason?: string;
  @ApiPropertyOptional() notes?: string;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}
