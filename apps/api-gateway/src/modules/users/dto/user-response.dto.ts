import { ApiProperty } from '@nestjs/swagger';

import { UserRole, UserStatus, AuthProvider } from '@prisma/client';

export class UserResponseDto {
  @ApiProperty({
    example: 'c7c1f1e2-6f2d-4f77-a111-123456789abc',
  })
  id: string;

  @ApiProperty({
    example: 'Hari',
  })
  firstName: string;

  @ApiProperty({
    example: 'Haran',
    required: false,
  })
  lastName?: string;

  @ApiProperty({
    example: 'hari@example.com',
    required: false,
  })
  email?: string;

  @ApiProperty({
    example: '+919876543210',
    required: false,
  })
  phone?: string;

  @ApiProperty({
    enum: UserRole,
    example: UserRole.CUSTOMER,
  })
  role: UserRole;

  @ApiProperty({
    enum: UserStatus,
    example: UserStatus.ACTIVE,
  })
  status: UserStatus;

  @ApiProperty({
    enum: AuthProvider,
    example: AuthProvider.EMAIL,
  })
  provider: AuthProvider;

  @ApiProperty({
    example: '2026-05-29T10:00:00.000Z',
  })
  createdAt: Date;

  @ApiProperty({
    example: '2026-05-29T10:00:00.000Z',
  })
  updatedAt: Date;
}
