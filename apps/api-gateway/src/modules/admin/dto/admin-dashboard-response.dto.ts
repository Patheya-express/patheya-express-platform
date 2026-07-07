import { ApiProperty } from '@nestjs/swagger';

import { HealthResponseDto } from '../../health/dto/health-response.dto';

import { AdminDashboardMetricsDto } from './admin-dashboard-metrics.dto';
import { AdminAlertDto } from './admin-alert.dto';
import { AdminNotificationDto } from './admin-notification.dto';

export class AdminDashboardResponseDto {
  @ApiProperty({
    type: AdminDashboardMetricsDto,
  })
  metrics: AdminDashboardMetricsDto;

  @ApiProperty({
    type: HealthResponseDto,
  })
  health: HealthResponseDto;

  @ApiProperty({
    type: [AdminAlertDto],
    description: 'Active platform alerts. Empty until alerting is implemented.',
  })
  alerts: AdminAlertDto[];

  @ApiProperty({
    type: [AdminNotificationDto],
    description: 'Admin-facing notifications. Empty until notification sourcing is implemented.',
  })
  notifications: AdminNotificationDto[];
}
