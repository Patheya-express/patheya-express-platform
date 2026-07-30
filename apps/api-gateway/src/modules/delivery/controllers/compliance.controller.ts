import { Controller, Get, Param, UseGuards } from '@nestjs/common';

import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { UserRole } from '@prisma/client';

import { ComplianceService } from '../services/compliance.service';

import { DeliveryComplianceResponseDto } from '../dto/delivery-compliance-response.dto';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@ApiTags('Delivery Compliance')
@ApiBearerAuth('JWT-auth')
@Controller('delivery/compliance')
@UseGuards(JwtAuthGuard)
export class DeliveryComplianceController {
  constructor(private readonly complianceService: ComplianceService) {}

  @ApiOperation({ summary: 'My compliance/readiness snapshot' })
  @ApiOkResponse({ type: DeliveryComplianceResponseDto })
  @Get()
  getSnapshot(@CurrentUser() user: any) {
    return this.complianceService.getSnapshotForSelf(user.userId);
  }
}

@ApiTags('Delivery Compliance (Admin)')
@ApiBearerAuth('JWT-auth')
@Controller('delivery/admin/:deliveryPartnerId/compliance')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class AdminComplianceController {
  constructor(private readonly complianceService: ComplianceService) {}

  @ApiOperation({ summary: "A partner's compliance/readiness snapshot" })
  @ApiParam({ name: 'deliveryPartnerId' })
  @ApiOkResponse({ type: DeliveryComplianceResponseDto })
  @Get()
  getSnapshot(@Param('deliveryPartnerId') deliveryPartnerId: string) {
    return this.complianceService.getSnapshot(deliveryPartnerId);
  }
}
