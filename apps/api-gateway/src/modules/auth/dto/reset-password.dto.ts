import { IsString, MinLength } from 'class-validator';

import { ApiProperty } from '@nestjs/swagger';

export class ResetPasswordDto {
  @ApiProperty({
    description:
      'The raw reset token from the emailed link (not the DB-stored hash).',
  })
  @IsString()
  token: string;

  @ApiProperty({
    example: 'NewPassword@123',
    description: 'New password with minimum 8 characters.',
  })
  @IsString()
  @MinLength(8)
  newPassword: string;
}
