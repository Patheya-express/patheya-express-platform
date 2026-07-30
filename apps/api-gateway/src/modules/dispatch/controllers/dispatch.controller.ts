import {
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';

import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';

import { AssignmentStatus } from '@prisma/client';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';

import { DispatchService } from '../services/dispatch.service';

import { DeliveryAssignmentResponseDto } from '../dto/delivery-assignment-response.dto';

import { DispatchActionResponseDto } from '../dto/dispatch-action-response.dto';
import { GetDispatchAssignmentsQueryDto } from '../dto/get-dispatch-assignments-query.dto';

@ApiTags('Dispatch')
@ApiBearerAuth('JWT-auth')
@Controller('dispatch')
export class DispatchController {
  constructor(private readonly dispatchService: DispatchService) {}

  @UseGuards(JwtAuthGuard)
  @Get('assignments')
  @ApiOperation({
    summary: 'Get delivery partner assignments',
    description:
      'Returns all delivery assignments assigned to the authenticated delivery partner, optionally narrowed to one status.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: AssignmentStatus,
    description:
      'Optional — omit to get every assignment (unchanged default behavior); pass to narrow to one status (Pending/Accepted/Rejected/Expired).',
  })
  @ApiOkResponse({
    description: 'Assignments fetched successfully',
    type: DeliveryAssignmentResponseDto,
    isArray: true,
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized',
  })
  getAssignments(
    @CurrentUser()
    user: any,

    @Query()
    query: GetDispatchAssignmentsQueryDto,
  ) {
    return this.dispatchService.getAssignments(user.userId, query.status);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('assignments/:id/accept')
  @ApiOperation({
    summary: 'Accept delivery assignment',
    description: 'Accept a pending delivery assignment.',
  })
  @ApiParam({
    name: 'id',
    description: 'Delivery assignment ID',
    example: 'clx123abc456',
  })
  @ApiOkResponse({
    description: 'Assignment accepted successfully',
    type: DispatchActionResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Assignment not found',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized',
  })
  acceptAssignment(
    @Param('id')
    id: string,

    @CurrentUser()
    user: any,
  ) {
    return this.dispatchService.acceptAssignment(id, user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('assignments/:id/reject')
  @ApiOperation({
    summary: 'Reject delivery assignment',
    description: 'Reject a pending delivery assignment.',
  })
  @ApiParam({
    name: 'id',
    description: 'Delivery assignment ID',
    example: 'clx123abc456',
  })
  @ApiOkResponse({
    description: 'Assignment rejected successfully',
    type: DispatchActionResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Assignment not found',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized',
  })
  rejectAssignment(
    @Param('id')
    id: string,

    @CurrentUser()
    user: any,
  ) {
    return this.dispatchService.rejectAssignment(id, user.userId);
  }
}
