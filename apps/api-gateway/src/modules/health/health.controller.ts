import {
    Controller,
    Get,
  } from '@nestjs/common';
  
  import { HealthService }
  from './health.service';
  import {
    SkipThrottle,
  } from '@nestjs/throttler';
  
  @Controller('health')
  export class HealthController {
  
    constructor(
  
      private readonly healthService:
        HealthService,
  
    ) {}
  
    @Get()
    @SkipThrottle()
    async getHealth() {
    
      return this.healthService
        .getHealthStatus();
    
    }
  
  }