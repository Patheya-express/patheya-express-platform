import {
    Controller,
    Get,
    Query,
    UseGuards,
  } from '@nestjs/common';
  
  import { AuditService }
  from '../services/audit.service';
  
  import { JwtAuthGuard }
  from '../../auth/guards/jwt-auth.guard';
  
  @Controller('audit')
  export class AuditController {
  
    constructor(
  
      private readonly auditService:
        AuditService,
  
    ) {}
  
    @UseGuards(JwtAuthGuard)
  
    @Get()
  
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