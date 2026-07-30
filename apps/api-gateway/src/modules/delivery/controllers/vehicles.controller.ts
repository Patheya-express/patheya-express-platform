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
  ApiTags,
} from '@nestjs/swagger';

import { VehiclesService } from '../services/vehicles.service';

import { CreateVehicleDto } from '../dto/create-vehicle.dto';
import { UpdateVehicleDto } from '../dto/update-vehicle.dto';
import { VehicleResponseDto } from '../dto/vehicle-response.dto';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@ApiTags('Delivery Vehicles')
@ApiBearerAuth('JWT-auth')
@Controller('delivery/vehicles')
@UseGuards(JwtAuthGuard)
export class VehiclesController {
  constructor(private readonly vehiclesService: VehiclesService) {}

  @ApiOperation({ summary: 'List my active vehicles' })
  @ApiOkResponse({ type: VehicleResponseDto, isArray: true })
  @Get()
  list(@CurrentUser() user: any) {
    return this.vehiclesService.list(user.userId);
  }

  @ApiOperation({
    summary: 'Register a vehicle',
    description:
      'The first vehicle a partner registers is always primary regardless of isPrimary.',
  })
  @ApiOkResponse({ type: VehicleResponseDto })
  @Post()
  create(@CurrentUser() user: any, @Body() dto: CreateVehicleDto) {
    return this.vehiclesService.create(user.userId, dto);
  }

  @ApiOperation({ summary: 'Update a vehicle' })
  @ApiParam({ name: 'vehicleId' })
  @ApiOkResponse({ type: VehicleResponseDto })
  @Patch(':vehicleId')
  update(
    @CurrentUser() user: any,
    @Param('vehicleId') vehicleId: string,
    @Body() dto: UpdateVehicleDto,
  ) {
    return this.vehiclesService.update(user.userId, vehicleId, dto);
  }

  @ApiOperation({ summary: 'Set a vehicle as primary' })
  @ApiParam({ name: 'vehicleId' })
  @ApiOkResponse({ type: VehicleResponseDto })
  @Patch(':vehicleId/set-primary')
  setPrimary(@CurrentUser() user: any, @Param('vehicleId') vehicleId: string) {
    return this.vehiclesService.setPrimary(user.userId, vehicleId);
  }

  @ApiOperation({
    summary: 'Deactivate (replace) a vehicle',
    description:
      'Soft — deactivates rather than deletes, preserving document history.',
  })
  @ApiParam({ name: 'vehicleId' })
  @ApiOkResponse({ type: VehicleResponseDto })
  @Delete(':vehicleId')
  deactivate(@CurrentUser() user: any, @Param('vehicleId') vehicleId: string) {
    return this.vehiclesService.deactivate(user.userId, vehicleId);
  }
}
