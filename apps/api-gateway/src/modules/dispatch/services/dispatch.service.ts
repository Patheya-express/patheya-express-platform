import {
    Injectable,
    NotFoundException,
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
import { any } from 'joi';
  
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
    ) {
  
      return this.dispatchRepository
        .updateAssignmentStatus(
  
          assignmentId,
  
          AssignmentStatus
            .ACCEPTED,
  
        );
  
    }
  
    async rejectAssignment(
      assignmentId: string,
    ) {
  
      return this.dispatchRepository
        .updateAssignmentStatus(
  
          assignmentId,
  
          AssignmentStatus
            .REJECTED,
  
        );
  
    }
  
    async getAssignments(
      partnerId: string,
    ) {
  
      return this.dispatchRepository
        .findPartnerAssignments(
          partnerId,
        );
  
    }
  
  }