import {
  IsEmail,
  IsString,
} from 'class-validator';

import {
  ApiProperty,
} from '@nestjs/swagger';

export class LoginDto {

  @ApiProperty({
    example: 'hari@example.com',
    description: 'User email address',
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    example: 'Password@123',
    description: 'User password',
  })
  @IsString()
  password: string;

}