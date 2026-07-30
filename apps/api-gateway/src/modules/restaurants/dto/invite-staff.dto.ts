import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { RestaurantStaffRole } from '@prisma/client';

import { IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';

export class InviteStaffDto {
  @ApiProperty({
    example: 'manager@example.com',
    description: 'Must already be a registered Patheya Express user.',
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    enum: RestaurantStaffRole,
    example: RestaurantStaffRole.BRANCH_MANAGER,
  })
  @IsEnum(RestaurantStaffRole)
  role: RestaurantStaffRole;

  @ApiPropertyOptional({
    description:
      'Scopes the invite to one branch — leave empty for restaurant-wide roles like OWNER/CO_OWNER/FINANCE_MANAGER.',
  })
  @IsOptional()
  @IsString()
  branchId?: string;
}
