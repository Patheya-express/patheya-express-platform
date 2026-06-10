import {
  Controller,
  Get,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';

import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';

import { JwtAuthGuard }
from '../../auth/guards/jwt-auth.guard';

import { CurrentUser }
from '../../auth/decorators/current-user.decorator';

import { DispatchService }
from '../services/dispatch.service';

@ApiTags('Dispatch')
@ApiBearerAuth()
@Controller('dispatch')
export class DispatchController {

  constructor(

    private readonly dispatchService:
      DispatchService,

  ) {}

  @UseGuards(JwtAuthGuard)

  @Get('assignments')

  @ApiOperation({
    summary:
      'Get delivery partner assignments',
    description:
      'Returns all delivery assignments assigned to the authenticated delivery partner.',
  })

  @ApiOkResponse({
    description:
      'Assignments fetched successfully',
  })

  @ApiUnauthorizedResponse({
    description:
      'Unauthorized',
  })

  getAssignments(

    @CurrentUser()
    user: any,

  ) {

    return this.dispatchService
      .getAssignments(
        user.userId,
      );

  }

  @UseGuards(JwtAuthGuard)

  @Patch(
    'assignments/:id/accept',
  )

  @ApiOperation({
    summary:
      'Accept delivery assignment',
    description:
      'Accept a pending delivery assignment.',
  })

  @ApiParam({
    name: 'id',
    description:
      'Delivery assignment ID',
    example:
      'clx123abc456',
  })

  @ApiOkResponse({
    description:
      'Assignment accepted successfully',
  })

  @ApiNotFoundResponse({
    description:
      'Assignment not found',
  })

  @ApiUnauthorizedResponse({
    description:
      'Unauthorized',
  })

  acceptAssignment(

    @Param('id')
    id: string,

  ) {

    return this.dispatchService
      .acceptAssignment(
        id,
      );

  }

  @UseGuards(JwtAuthGuard)

  @Patch(
    'assignments/:id/reject',
  )

  @ApiOperation({
    summary:
      'Reject delivery assignment',
    description:
      'Reject a pending delivery assignment.',
  })

  @ApiParam({
    name: 'id',
    description:
      'Delivery assignment ID',
    example:
      'clx123abc456',
  })

  @ApiOkResponse({
    description:
      'Assignment rejected successfully',
  })

  @ApiNotFoundResponse({
    description:
      'Assignment not found',
  })

  @ApiUnauthorizedResponse({
    description:
      'Unauthorized',
  })

  rejectAssignment(

    @Param('id')
    id: string,

  ) {

    return this.dispatchService
      .rejectAssignment(
        id,
      );

  }

}