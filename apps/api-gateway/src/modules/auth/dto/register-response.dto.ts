import { ApiProperty } from '@nestjs/swagger';

import { AuthUserDto } from './auth-user.dto';

export class RegisterResponseDto {
  @ApiProperty({
    type: AuthUserDto,
  })
  user: AuthUserDto;

  @ApiProperty({
    example: 'eyJhbGciOi...',
  })
  accessToken: string;

  @ApiProperty({
    example: 'eyJhbGciOi...',
  })
  refreshToken: string;
}
