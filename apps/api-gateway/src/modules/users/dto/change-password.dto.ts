import { IsString, Matches, MinLength } from 'class-validator';

import { ApiProperty } from '@nestjs/swagger';

const STRONG_PASSWORD_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/;

export class ChangePasswordDto {
  @ApiProperty({
    description: "The account's current password",
  })
  @IsString()
  currentPassword: string;

  @ApiProperty({
    description:
      'New password — minimum 8 characters, must include an uppercase letter, a lowercase letter, a number, and a symbol.',
  })
  @IsString()
  @MinLength(8)
  @Matches(STRONG_PASSWORD_REGEX, {
    message:
      'newPassword must contain at least one uppercase letter, one lowercase letter, one number, and one symbol',
  })
  newPassword: string;
}
