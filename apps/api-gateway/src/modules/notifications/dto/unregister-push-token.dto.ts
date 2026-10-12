import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UnregisterPushTokenDto {
  @ApiProperty({
    description: 'The device push token to remove from the calling account',
  })
  @IsString()
  @IsNotEmpty()
  token: string;
}
