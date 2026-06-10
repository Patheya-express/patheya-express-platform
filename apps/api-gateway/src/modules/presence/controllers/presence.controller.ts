import {
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';

import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiOkResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { JwtAuthGuard }
from '../../auth/guards/jwt-auth.guard';

import { CurrentUser }
from '../../auth/decorators/current-user.decorator';

import { PresenceService }
from '../services/presence.service';

@ApiTags('Presence')
@ApiBearerAuth()
@Controller('presence')
export class PresenceController {

  constructor(

    private readonly presenceService:
      PresenceService,

  ) {}

  @UseGuards(JwtAuthGuard)

  @Post('online')

  @ApiOperation({
    summary:
      'Mark delivery partner online',
    description:
      'Marks the authenticated delivery partner as online and available for realtime presence tracking.',
  })

  @ApiOkResponse({
    description:
      'Partner marked online successfully',
  })

  @ApiUnauthorizedResponse({
    description:
      'Unauthorized',
  })

  async markOnline(

    @CurrentUser()
    user: any,

  ) {

    return this.presenceService
      .markOnline(
        user.userId,
      );

  }

  @UseGuards(JwtAuthGuard)

  @Post('offline')

  @ApiOperation({
    summary:
      'Mark delivery partner offline',
    description:
      'Marks the authenticated delivery partner as offline.',
  })

  @ApiOkResponse({
    description:
      'Partner marked offline successfully',
  })

  @ApiUnauthorizedResponse({
    description:
      'Unauthorized',
  })

  async markOffline(

    @CurrentUser()
    user: any,

  ) {

    return this.presenceService
      .markOffline(
        user.userId,
      );

  }

  @UseGuards(JwtAuthGuard)

  @Get(':partnerId')

  @ApiOperation({
    summary:
      'Get delivery partner presence status',
    description:
      'Returns online/offline status and last seen information for a delivery partner.',
  })

  @ApiParam({
    name: 'partnerId',
    description:
      'Delivery partner ID',
    example:
      'clx123abc456',
  })

  @ApiOkResponse({
    description:
      'Presence status fetched successfully',
  })

  @ApiUnauthorizedResponse({
    description:
      'Unauthorized',
  })

  async getStatus(

    @Param('partnerId')
    partnerId: string,

  ) {

    return this.presenceService
      .getStatus(
        partnerId,
      );

  }

}