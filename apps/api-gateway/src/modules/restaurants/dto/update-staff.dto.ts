import { ApiPropertyOptional } from '@nestjs/swagger';

import { RestaurantStaffRole } from '@prisma/client';

import { IsEnum, IsOptional, IsString } from 'class-validator';

export class UpdateStaffDto {
  @ApiPropertyOptional({ enum: RestaurantStaffRole })
  @IsOptional()
  @IsEnum(RestaurantStaffRole)
  role?: RestaurantStaffRole;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  branchId?: string;
}
