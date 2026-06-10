import {
    Injectable,
  } from '@nestjs/common';
  
  import {
    InjectQueue,
  } from '@nestjs/bullmq';
  
  import {
    Queue,
  } from 'bullmq';
  
  @Injectable()
  export class QueueService {
  
    constructor(
        
      @InjectQueue(
        'dispatch'
      )
      private readonly dispatchQueue:
      Queue,
  
      @InjectQueue(
        'notifications',
      )
  
      private readonly notificationQueue:
        Queue,
      
      @InjectQueue(
          'payments',
        )
        private readonly paymentsQueue:
          Queue,
  
    ) {}
  
    async addNotificationJob(
      data: any,
    ) {
  
      return this.notificationQueue.add(
  
        'send-notification',
  
        data,
  
      );
  
    }
    async addAssignmentExpiryJob(

        assignmentId: string,
      
      ) {
      
        return this.dispatchQueue
          .add(
      
            'assignment-expiry',
      
            {
      
              assignmentId,
      
            },
      
            {
      
              delay:
                10 * 60 * 1000,
      
            },
      
          );
      
      }
      async addPaymentReconciliationJob() {

        return this.paymentsQueue.upsertJobScheduler(
          'payment-reconciliation',
        
          {
            every:
              5 * 60 * 1000,
          },
        
          {
            name:
              'reconcile-pending-payments',
        
            data: {},
          },
        );
      
      }
  
  }