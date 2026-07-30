import { IsString } from 'class-validator';

import { ApiProperty } from '@nestjs/swagger';

export class CreateNotificationDto {
  @ApiProperty({
    example: 'clx123abc456',
    description: 'User ID receiving the notification',
  })
  @IsString()
  userId: string;

  @ApiProperty({
    example: 'Order Accepted',
    description: 'Notification title',
  })
  @IsString()
  title: string;

  @ApiProperty({
    example: 'Your order has been accepted by the restaurant.',
    description: 'Notification message',
  })
  @IsString()
  message: string;
}
