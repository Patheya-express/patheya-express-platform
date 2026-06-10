import {
    Injectable,
    NotFoundException,
    ForbiddenException,
    BadRequestException,
  } from '@nestjs/common';
  
  import {
    AssignmentStatus,
  } from '@prisma/client';
  
  import { DispatchRepository }
  from '../repositories/dispatch.repository';
  
  import { RealtimeService }
  from '../../realtime/services/realtime.service';

  import { QueueService } from 'src/infrastructure/queues/queue.service';

  import { PresenceService }
from '../../presence/services/presence.service';
  
  @Injectable()
  export class DispatchService {
  
    constructor(
  
      private readonly dispatchRepository:
        DispatchRepository,
  
      private readonly realtimeService:
        RealtimeService,
      private readonly queueService:
        QueueService,
      private readonly presenceService:
        PresenceService,
  
    ) {}
  
    async assignOrder(
      orderId: string,
    ) {
  
      const partners =
  
        await this.dispatchRepository
          .findAvailablePartners();
          const onlinePartners:any[]=[];

          for (const partner of partners) {
          
            const isOnline =
          
              await this.presenceService
                .isOnline(
                  partner.id,
                );
          
            if (isOnline) {
          
              onlinePartners.push(
                partner,
              );
          
            }
          
          }
  
        if (!onlinePartners.length) {
  
        throw new NotFoundException(
          'No delivery partners available',
        );
  
      }
  
      const partner =
      onlinePartners[0];
  
      const assignment =
  
        await this.dispatchRepository
          .createAssignment({
  
            orderId,
  
            deliveryPartnerId:
              partner.id,
  
            expiresAt:
              new Date(
  
                Date.now() +
                10 * 60 * 1000,
  
              ),
  
          });
  
      this.realtimeService
        .emitToUser(
  
          partner.userId,
  
          'delivery.assignment',
  
          {
  
            assignmentId:
              assignment.id,
  
            orderId,
  
          },
  
        );
        await this.queueService
        .addAssignmentExpiryJob(
      
          assignment.id,
      
        );
  
      return assignment;
  
    }
  
    async acceptAssignment(

      assignmentId: string,
    
      userId: string,
    
    ) {
    
      const partner =
    
        await this.dispatchRepository
          .findPartnerByUserId(
            userId,
          );
    
      if (!partner) {
    
        throw new NotFoundException(
          'Delivery partner not found',
        );
    
      }
    
      const assignment =
    
        await this.dispatchRepository
          .findAssignmentById(
            assignmentId,
          );
    
      if (!assignment) {
    
        throw new NotFoundException(
          'Assignment not found',
        );
    
      }
    
      if (
    
        assignment.deliveryPartnerId !==
        partner.id
    
      ) {
    
        throw new ForbiddenException(
          'Assignment does not belong to you',
        );
    
      }
    
      if (
    
        assignment.status !==
        AssignmentStatus.PENDING
    
      ) {
    
        throw new BadRequestException(
          'Only pending assignments can be accepted',
        );
    
      }
    
      await this.dispatchRepository
      .updateAssignmentStatus(
    
        assignmentId,
    
        AssignmentStatus.ACCEPTED,
    
      );
    
    await this.dispatchRepository
      .assignOrderToPartner(
    
        assignment.orderId,
    
        partner.userId,
    
      );
    
    return {
      success: true,
    };
    
    }
  
    async rejectAssignment(

      assignmentId: string,
    
      userId: string,
    
    ) {
    
      const partner =
    
        await this.dispatchRepository
          .findPartnerByUserId(
            userId,
          );
    
      if (!partner) {
    
        throw new NotFoundException(
          'Delivery partner not found',
        );
    
      }
    
      const assignment =
    
        await this.dispatchRepository
          .findAssignmentById(
            assignmentId,
          );
    
      if (!assignment) {
    
        throw new NotFoundException(
          'Assignment not found',
        );
    
      }
    
      if (
    
        assignment.deliveryPartnerId !==
        partner.id
    
      ) {
    
        throw new ForbiddenException(
          'Assignment does not belong to you',
        );
    
      }
    
      if (
    
        assignment.status !==
        AssignmentStatus.PENDING
    
      ) {
    
        throw new BadRequestException(
          'Only pending assignments can be rejected',
        );
    
      }
    
      return this.dispatchRepository
        .updateAssignmentStatus(
    
          assignmentId,
    
          AssignmentStatus.REJECTED,
    
        );
    
    }
  
    async getAssignments(
      userId: string,
    ) {
    
      const partner =
    
        await this.dispatchRepository
          .findPartnerByUserId(
            userId,
          );
    
      if (!partner) {
    
        throw new NotFoundException(
          'Delivery partner not found',
        );
    
      }
    
      return this.dispatchRepository
        .findPartnerAssignments(
          partner.id,
        );
    
    }
  
  }