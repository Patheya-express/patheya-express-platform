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

import { BranchesService } from '../services/branches.service';

import { CreateBranchDto } from '../dto/create-branch.dto';
import { UpdateBranchDto } from '../dto/update-branch.dto';
import { BranchResponseDto } from '../dto/branch-response.dto';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@ApiTags('Restaurant Branches')
@Controller('restaurants/:restaurantId/branches')
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) {}

  @ApiOperation({
    summary: 'List branches',
    description: 'Public — no authentication required.',
  })
  @ApiParam({ name: 'restaurantId' })
  @ApiOkResponse({ type: BranchResponseDto, isArray: true })
  @Get()
  findAll(@Param('restaurantId') restaurantId: string) {
    return this.branchesService.findAll(restaurantId);
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Create branch' })
  @ApiParam({ name: 'restaurantId' })
  @ApiOkResponse({ type: BranchResponseDto })
  @ApiResponse({
    status: 403,
    description: 'Caller does not manage this restaurant',
  })
  @UseGuards(JwtAuthGuard)
  @Post()
  create(
    @CurrentUser() user: any,
    @Param('restaurantId') restaurantId: string,
    @Body() dto: CreateBranchDto,
  ) {
    return this.branchesService.create(restaurantId, dto, user);
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Update branch' })
  @ApiParam({ name: 'restaurantId' })
  @ApiParam({ name: 'branchId' })
  @ApiOkResponse({ type: BranchResponseDto })
  @ApiResponse({
    status: 403,
    description: 'Caller does not manage this branch',
  })
  @ApiResponse({ status: 404, description: 'Branch not found' })
  @UseGuards(JwtAuthGuard)
  @Patch(':branchId')
  update(
    @CurrentUser() user: any,
    @Param('restaurantId') restaurantId: string,
    @Param('branchId') branchId: string,
    @Body() dto: UpdateBranchDto,
  ) {
    return this.branchesService.update(restaurantId, branchId, dto, user);
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Remove branch (soft delete)' })
  @ApiParam({ name: 'restaurantId' })
  @ApiParam({ name: 'branchId' })
  @ApiResponse({
    status: 403,
    description: 'Caller does not manage this restaurant',
  })
  @ApiResponse({ status: 404, description: 'Branch not found' })
  @UseGuards(JwtAuthGuard)
  @Delete(':branchId')
  remove(
    @CurrentUser() user: any,
    @Param('restaurantId') restaurantId: string,
    @Param('branchId') branchId: string,
  ) {
    return this.branchesService.remove(restaurantId, branchId, user);
  }
}
