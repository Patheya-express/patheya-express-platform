import { Controller, Get, UseGuards } from '@nestjs/common';

import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';

import { UserRole } from '@prisma/client';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';

import { AdminService } from '../services/admin.service';
import { AdminDashboardResponseDto } from '../dto/admin-dashboard-response.dto';

@ApiTags('Admin')
@ApiBearerAuth('JWT-auth')
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @Get('dashboard')
  @ApiOperation({
    summary: 'Get admin dashboard data',
    description:
      'Returns platform-wide metrics, health status, alerts, and notifications for the admin dashboard.',
  })
  @ApiOkResponse({
    description: 'Admin dashboard data retrieved successfully',
    type: AdminDashboardResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized',
  })
  @ApiForbiddenResponse({
    description: 'Forbidden',
  })
  getDashboard(): Promise<AdminDashboardResponseDto> {
    return this.adminService.getDashboard();
  }
}
