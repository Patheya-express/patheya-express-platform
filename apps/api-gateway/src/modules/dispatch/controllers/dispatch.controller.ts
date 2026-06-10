import {
    Controller,
    Get,
    Param,
    Patch,
    UseGuards,
  } from '@nestjs/common';
  
  import { JwtAuthGuard }
  from '../../auth/guards/jwt-auth.guard';
  
  import { CurrentUser }
  from '../../auth/decorators/current-user.decorator';
  
  import { DispatchService }
  from '../services/dispatch.service';
  
  @Controller('dispatch')
  export class DispatchController {
  
    constructor(
  
      private readonly dispatchService:
        DispatchService,
  
    ) {}
  
    @UseGuards(JwtAuthGuard)
  
    @Get('assignments')
  
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