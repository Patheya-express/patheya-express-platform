import { ApiProperty } from '@nestjs/swagger';

import { UserRole } from '@prisma/client';

export class ProfileResponseDto {
  @ApiProperty({
    example: 'c7c1f1e2-6f2d-4f77-a111-123456789abc',
  })
  userId: string;

  @ApiProperty({
    example: 'hari@example.com',
  })
  email: string;

  @ApiProperty({
    enum: UserRole,
    example: UserRole.CUSTOMER,
  })
  role: UserRole;
}
