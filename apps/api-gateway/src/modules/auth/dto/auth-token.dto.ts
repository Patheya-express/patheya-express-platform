import { ApiProperty } from '@nestjs/swagger';

export class AuthTokensDto {
  @ApiProperty({
    example: 'eyJhbGciOi...',
  })
  accessToken: string;

  @ApiProperty({
    example: 'eyJhbGciOi...',
  })
  refreshToken: string;
}
