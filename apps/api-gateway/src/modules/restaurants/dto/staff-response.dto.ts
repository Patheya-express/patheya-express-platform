import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { RestaurantStaffRole, RestaurantStaffStatus } from '@prisma/client';

import { RestaurantOwnerDto } from './restaurant-owner.dto';

export class StaffResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() restaurantId: string;
  @ApiPropertyOptional() branchId?: string;
  @ApiProperty({ enum: RestaurantStaffRole }) role: RestaurantStaffRole;
  @ApiProperty({ enum: RestaurantStaffStatus }) status: RestaurantStaffStatus;
  @ApiPropertyOptional({ type: RestaurantOwnerDto }) user?: RestaurantOwnerDto;
  @ApiProperty() invitedAt: Date;
  @ApiPropertyOptional() respondedAt?: Date;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}
