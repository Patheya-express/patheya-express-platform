import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';

import {
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { HealthService } from './health.service';
import { SkipThrottle } from '@nestjs/throttler';
import { HealthResponseDto } from './dto/health-response.dto';
import { LivenessResponseDto } from './dto/liveness-response.dto';
import { ReadinessResponseDto } from './dto/readiness-response.dto';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @SkipThrottle()
  @ApiOperation({
    summary: 'Get platform health status',
  })
  @ApiOkResponse({
    description: 'Health status retrieved successfully',
    type: HealthResponseDto,
  })
  async getHealth(): Promise<HealthResponseDto> {
    return this.healthService.getHealthStatus();
  }

  @Get('live')
  @SkipThrottle()
  @ApiOperation({
    summary: 'Liveness probe',
    description:
      'Confirms only that the process itself is up — no dependency checks. Used by orchestrators to decide whether to restart the container.',
  })
  @ApiOkResponse({
    description: 'Process is alive',
    type: LivenessResponseDto,
  })
  getLiveness(): LivenessResponseDto {
    return this.healthService.getLiveness();
  }

  @Get('ready')
  @SkipThrottle()
  @ApiOperation({
    summary: 'Readiness probe',
    description:
      'Verifies Database, Redis, and the BullMQ queues are reachable. Used by orchestrators to decide whether to route traffic to this instance.',
  })
  @ApiOkResponse({
    description: 'Every checked dependency is reachable',
    type: ReadinessResponseDto,
  })
  @ApiResponse({
    status: 503,
    description: 'At least one dependency is unreachable',
    type: ReadinessResponseDto,
  })
  async getReadiness(): Promise<ReadinessResponseDto> {
    const readiness = await this.healthService.getReadiness();

    if (readiness.status !== 'ok') {
      // GlobalExceptionFilter only surfaces `.message`, so summarize per-dependency status in
      // the message itself rather than passing the DTO as the response body (which would be
      // dropped) — keeps this consistent with how every other error in the API is shaped.
      throw new ServiceUnavailableException(
        `Not ready: database=${readiness.database}, redis=${readiness.redis}, queues=${readiness.queues}, storage=${readiness.storage}`,
      );
    }

    return readiness;
  }
}
