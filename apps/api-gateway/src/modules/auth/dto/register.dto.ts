import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Rejects empty and whitespace-only names — every registration form already requires both
 *  names, so this keeps the backend authoritative rather than trusting that client check. */
const NOT_BLANK = /\S/;

export class RegisterDto {
  @ApiProperty({
    example: 'Hari',
    description: 'First name',
  })
  @IsString()
  @Matches(NOT_BLANK, { message: 'First name is required' })
  firstName: string;

  @ApiProperty({
    example: 'Haran',
    description: 'Last name',
  })
  @IsString()
  @Matches(NOT_BLANK, { message: 'Last name is required' })
  lastName: string;

  @ApiProperty({
    example: 'hari@example.com',
    description: 'Email address',
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    example: 'Password@123',
    description: 'Password with minimum 8 characters',
  })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiPropertyOptional({
    example: 'A1B2C3D4',
    description: "Another user's referral code, if this signup was referred.",
  })
  @IsOptional()
  @IsString()
  referralCode?: string;
}
