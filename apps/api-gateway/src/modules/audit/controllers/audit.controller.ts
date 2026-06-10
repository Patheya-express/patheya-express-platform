import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';

import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiOkResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { AuditService }
from '../services/audit.service';

import { JwtAuthGuard }
from '../../auth/guards/jwt-auth.guard';

@ApiTags('Audit')
@ApiBearerAuth()
@Controller('audit')
export class AuditController {

  constructor(

    private readonly auditService:
      AuditService,

  ) {}

  @UseGuards(JwtAuthGuard)

  @Get()

  @ApiOperation({
    summary: 'Get audit logs',
    description:
      'Returns paginated audit logs ordered by newest first.',
  })

  @ApiQuery({
    name: 'page',
    required: false,
    example: 1,
    description: 'Page number',
  })

  @ApiQuery({
    name: 'limit',
    required: false,
    example: 20,
    description: 'Number of records per page',
  })

  @ApiOkResponse({
    description:
      'Audit logs fetched successfully',
  })

  @ApiUnauthorizedResponse({
    description:
      'Unauthorized',
  })

  getLogs(

    @Query('page')
    page = 1,

    @Query('limit')
    limit = 20,

  ) {

    return this.auditService
      .getLogs(

        Number(page),

        Number(limit),

      );

  }

}