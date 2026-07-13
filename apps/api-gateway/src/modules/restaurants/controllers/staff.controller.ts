import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { StaffService } from '../services/staff.service';

import { InviteStaffDto } from '../dto/invite-staff.dto';
import { UpdateStaffDto } from '../dto/update-staff.dto';
import { StaffResponseDto } from '../dto/staff-response.dto';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@ApiTags('Restaurant Staff')
@ApiBearerAuth('JWT-auth')
@Controller('restaurants/:restaurantId/staff')
@UseGuards(JwtAuthGuard)
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  @ApiOperation({ summary: 'List restaurant staff' })
  @ApiParam({ name: 'restaurantId' })
  @ApiOkResponse({ type: StaffResponseDto, isArray: true })
  @Get()
  findAll(
    @CurrentUser() user: any,
    @Param('restaurantId') restaurantId: string,
  ) {
    return this.staffService.findAll(restaurantId, user);
  }

  @ApiOperation({
    summary: 'Invite staff',
    description: 'Invitee must already have a Patheya Express account.',
  })
  @ApiParam({ name: 'restaurantId' })
  @ApiOkResponse({ type: StaffResponseDto })
  @ApiResponse({
    status: 403,
    description: 'Caller cannot manage staff for this restaurant',
  })
  @ApiResponse({ status: 404, description: 'No user with that email' })
  @ApiResponse({ status: 409, description: 'User is already staff' })
  @Post()
  invite(
    @CurrentUser() user: any,
    @Param('restaurantId') restaurantId: string,
    @Body() dto: InviteStaffDto,
  ) {
    return this.staffService.invite(restaurantId, dto, user);
  }

  @ApiOperation({ summary: 'Update a staff member’s role/branch scope' })
  @ApiParam({ name: 'restaurantId' })
  @ApiParam({ name: 'staffId' })
  @ApiOkResponse({ type: StaffResponseDto })
  @Patch(':staffId')
  update(
    @CurrentUser() user: any,
    @Param('restaurantId') restaurantId: string,
    @Param('staffId') staffId: string,
    @Body() dto: UpdateStaffDto,
  ) {
    return this.staffService.update(restaurantId, staffId, dto, user);
  }

  @ApiOperation({ summary: 'Accept your own staff invitation' })
  @ApiParam({ name: 'restaurantId' })
  @ApiParam({ name: 'staffId' })
  @ApiOkResponse({ type: StaffResponseDto })
  @Post(':staffId/accept')
  accept(
    @CurrentUser() user: any,
    @Param('restaurantId') restaurantId: string,
    @Param('staffId') staffId: string,
  ) {
    return this.staffService.accept(restaurantId, staffId, user);
  }

  @ApiOperation({ summary: 'Revoke a staff member’s access' })
  @ApiParam({ name: 'restaurantId' })
  @ApiParam({ name: 'staffId' })
  @Delete(':staffId')
  revoke(
    @CurrentUser() user: any,
    @Param('restaurantId') restaurantId: string,
    @Param('staffId') staffId: string,
  ) {
    return this.staffService.revoke(restaurantId, staffId, user);
  }
}
