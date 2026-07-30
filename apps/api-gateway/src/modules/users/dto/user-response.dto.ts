import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import {
  UserRole,
  UserStatus,
  AuthProvider,
  ThemePreference,
} from '@prisma/client';

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
    example: '/uploads/users/avatars/1234-photo.jpg',
    required: false,
  })
  avatarUrl?: string;

  @ApiProperty({
    example: 'en',
  })
  preferredLanguage: string;

  @ApiProperty({
    enum: ThemePreference,
    example: ThemePreference.SYSTEM,
  })
  themePreference: ThemePreference;

  @ApiProperty({
    example: false,
  })
  marketingOptIn: boolean;

  @ApiProperty({
    example: 'Asia/Kolkata',
  })
  timezone: string;

  @ApiPropertyOptional({
    description:
      'Percentage (0-100) of optional profile fields that have been filled in. Only populated on "my own profile" responses (GET/PATCH/avatar upload on /users/me), omitted on admin listing endpoints.',
    example: 75,
  })
  profileCompletion?: number;

  @ApiProperty({
    example: '2026-05-29T10:00:00.000Z',
  })
  createdAt: Date;

  @ApiProperty({
    example: '2026-05-29T10:00:00.000Z',
  })
  updatedAt: Date;
}
