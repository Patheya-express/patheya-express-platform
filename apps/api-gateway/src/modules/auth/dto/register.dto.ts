import {
  IsEmail,
  IsString,
  MinLength,
} from 'class-validator';

import {
  ApiProperty,
} from '@nestjs/swagger';

export class RegisterDto {

  @ApiProperty({
    example: 'Hari',
    description: 'First name',
  })
  @IsString()
  firstName: string;

  @ApiProperty({
    example: 'Haran',
    description: 'Last name',
  })
  @IsString()
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

}