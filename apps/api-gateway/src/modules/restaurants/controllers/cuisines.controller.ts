import { Controller, Get, Query } from '@nestjs/common';

import {
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { CuisinesService } from '../services/cuisines.service';
import { CuisineResponseDto } from '../dto/cuisine-response.dto';

@ApiTags('Cuisines')
@Controller('cuisines')
export class CuisinesController {
  constructor(private readonly cuisinesService: CuisinesService) {}

  @ApiOperation({
    summary: 'Get all cuisines',
    description:
      'Public — returns the cuisine taxonomy, used for discovery filter chips and typeahead. Optionally filtered by a search prefix/substring.',
  })
  @ApiQuery({ name: 'search', required: false })
  @ApiOkResponse({
    description: 'Cuisines retrieved successfully',
    type: CuisineResponseDto,
    isArray: true,
  })
  @Get()
  findAll(
    @Query('search')
    search?: string,
  ) {
    return this.cuisinesService.findAll(search);
  }
}
