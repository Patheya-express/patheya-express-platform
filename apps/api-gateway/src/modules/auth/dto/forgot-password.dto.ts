import { IsEmail } from 'class-validator';

import { ApiProperty } from '@nestjs/swagger';

export class ForgotPasswordDto {
  @ApiProperty({
    example: 'hari@example.com',
    description: 'Email address of the account to send a reset link to.',
  })
  @IsEmail()
  email: string;
}
