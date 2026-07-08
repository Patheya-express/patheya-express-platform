import { ApiProperty } from '@nestjs/swagger';

export class NotificationPreferencesResponseDto {
  @ApiProperty({ description: 'Order status update emails', example: true })
  orderUpdatesEmail: boolean;

  @ApiProperty({ description: 'Order status update SMS', example: true })
  orderUpdatesSms: boolean;

  @ApiProperty({
    description: 'Order status update push notifications',
    example: true,
  })
  orderUpdatesPush: boolean;

  @ApiProperty({ description: 'Promotional emails', example: false })
  promotionsEmail: boolean;

  @ApiProperty({ description: 'Promotional SMS', example: false })
  promotionsSms: boolean;

  @ApiProperty({
    description: 'Promotional push notifications',
    example: false,
  })
  promotionsPush: boolean;

  @ApiProperty({ description: 'Review-related emails', example: true })
  reviewsEmail: boolean;

  @ApiProperty({ description: 'Review-related SMS', example: false })
  reviewsSms: boolean;

  @ApiProperty({
    description: 'Review-related push notifications',
    example: true,
  })
  reviewsPush: boolean;

  @ApiProperty({ description: 'System/account emails', example: true })
  systemEmail: boolean;

  @ApiProperty({ description: 'System/account SMS', example: false })
  systemSms: boolean;

  @ApiProperty({
    description: 'System/account push notifications',
    example: true,
  })
  systemPush: boolean;
}
