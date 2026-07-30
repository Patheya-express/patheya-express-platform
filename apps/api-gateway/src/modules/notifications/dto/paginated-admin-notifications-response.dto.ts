import { ApiProperty } from '@nestjs/swagger';

import { AdminNotificationResponseDto } from './admin-notification-response.dto';

export class PaginatedAdminNotificationsResponseDto {
  @ApiProperty({
    type: AdminNotificationResponseDto,
    isArray: true,
  })
  items: AdminNotificationResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;

  @ApiProperty()
  totalPages: number;
}
