import { ApiProperty } from '@nestjs/swagger';

/** Deliberately identical shape/wording regardless of whether the email matched an account, or
 *  (for reset) regardless of why a token was rejected — see AuthService for the reasoning. */
export class PasswordResetMessageDto {
  @ApiProperty({
    example: 'If an account exists for that email, a reset link has been sent.',
  })
  message: string;
}
