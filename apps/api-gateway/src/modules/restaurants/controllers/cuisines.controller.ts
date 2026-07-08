import { Controller, Get } from '@nestjs/common';

import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CuisinesService } from '../services/cuisines.service';
import { CuisineResponseDto } from '../dto/cuisine-response.dto';

@ApiTags('Cuisines')
@Controller('cuisines')
export class CuisinesController {
  constructor(private readonly cuisinesService: CuisinesService) {}

  @ApiOperation({
    summary: 'Get all cuisines',
    description:
      'Public — returns the full cuisine taxonomy, used for discovery filter chips.',
  })
  @ApiOkResponse({
    description: 'Cuisines retrieved successfully',
    type: CuisineResponseDto,
    isArray: true,
  })
  @Get()
  findAll() {
    return this.cuisinesService.findAll();
  }
}
