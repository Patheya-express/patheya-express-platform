import { IsString } from 'class-validator';

import { ApiProperty } from '@nestjs/swagger';

export class RegisterPushTokenDto {
  @ApiProperty({
    example: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
    description: 'Device push notification token',
  })
  @IsString()
  token: string;

  @ApiProperty({
    example: 'android',
    description: 'Device platform (android, ios, web)',
  })
  @IsString()
  platform: string;
}
