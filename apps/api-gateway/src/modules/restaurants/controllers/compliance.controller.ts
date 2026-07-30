import { Controller, Get, Param, UseGuards } from '@nestjs/common';

import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { ComplianceService } from '../services/compliance.service';

import { ComplianceResponseDto } from '../dto/compliance-response.dto';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@ApiTags('Restaurant Compliance')
@ApiBearerAuth('JWT-auth')
@Controller('restaurants/:restaurantId/compliance')
@UseGuards(JwtAuthGuard)
export class ComplianceController {
  constructor(private readonly complianceService: ComplianceService) {}

  @ApiOperation({
    summary: 'Compliance snapshot',
    description:
      'Computed on demand from verification stage + document expiry/status — not a stored score.',
  })
  @ApiParam({ name: 'restaurantId' })
  @ApiOkResponse({ type: ComplianceResponseDto })
  @Get()
  getSnapshot(
    @CurrentUser() user: any,
    @Param('restaurantId') restaurantId: string,
  ) {
    return this.complianceService.getSnapshot(restaurantId, user);
  }
}
