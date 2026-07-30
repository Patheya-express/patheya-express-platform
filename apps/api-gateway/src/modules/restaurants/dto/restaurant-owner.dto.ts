import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Minimal owner projection — never includes passwordHash or any authentication field. */
export class RestaurantOwnerDto {
  @ApiProperty({
    example: 'c7c1f1e2-6f2d-4f77-a111-123456789abc',
  })
  id: string;

  @ApiProperty({
    example: 'Hari',
  })
  firstName: string;

  @ApiPropertyOptional({
    example: 'Haran',
  })
  lastName?: string;

  @ApiPropertyOptional({
    example: 'owner@example.com',
  })
  email?: string;

  @ApiPropertyOptional({
    example: '+919876543210',
  })
  phone?: string;
}
