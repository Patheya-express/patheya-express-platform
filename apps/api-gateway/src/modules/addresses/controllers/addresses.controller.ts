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
  ApiCreatedResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

import { AddressesService } from '../services/addresses.service';

import { CreateAddressDto } from '../dto/create-address.dto';
import { UpdateAddressDto } from '../dto/update-address.dto';
import { AddressResponseDto } from '../dto/address-response.dto';

@ApiTags('Addresses')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('addresses')
export class AddressesController {
  constructor(private readonly addressesService: AddressesService) {}

  @ApiOperation({ summary: 'Get my saved addresses' })
  @ApiOkResponse({ type: AddressResponseDto, isArray: true })
  @Get()
  findAll(@CurrentUser() user: any) {
    return this.addressesService.findAllForCustomer(user.userId);
  }

  @ApiOperation({ summary: 'Get a saved address by ID' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: AddressResponseDto })
  @Get(':id')
  findOne(@CurrentUser() user: any, @Param('id') id: string) {
    return this.addressesService.findByIdForCustomer(id, user.userId);
  }

  @ApiOperation({ summary: 'Add a new address' })
  @ApiCreatedResponse({ type: AddressResponseDto })
  @Post()
  create(@CurrentUser() user: any, @Body() dto: CreateAddressDto) {
    return this.addressesService.create(user.userId, dto);
  }

  @ApiOperation({ summary: 'Update a saved address' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: AddressResponseDto })
  @Patch(':id')
  update(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.addressesService.update(user.userId, id, dto);
  }

  @ApiOperation({ summary: 'Set an address as the default' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: AddressResponseDto })
  @Patch(':id/default')
  setDefault(@CurrentUser() user: any, @Param('id') id: string) {
    return this.addressesService.setDefault(user.userId, id);
  }

  @ApiOperation({ summary: 'Delete a saved address' })
  @ApiParam({ name: 'id' })
  @Delete(':id')
  remove(@CurrentUser() user: any, @Param('id') id: string) {
    return this.addressesService.remove(user.userId, id);
  }
}
