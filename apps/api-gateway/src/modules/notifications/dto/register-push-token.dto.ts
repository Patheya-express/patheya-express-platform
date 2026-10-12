import { IsIn, IsString } from 'class-validator';

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
  // Push delivery is routed by platform (FCM for android, APNs for ios), so only these values
  // are meaningful.
  @IsIn(['android', 'ios', 'web'])
  platform: string;
}
