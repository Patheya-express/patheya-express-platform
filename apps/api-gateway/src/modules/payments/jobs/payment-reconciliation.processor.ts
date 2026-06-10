import {
    Processor,
    WorkerHost,
  } from '@nestjs/bullmq';
  
  import { Job }
  from 'bullmq';
  
  import {
    PaymentReconciliationService,
  } from '../../payments/services/payment-reconciliation.service';
  
  @Processor(
    'payments',
  )
  export class PaymentReconciliationProcessor
  extends WorkerHost {
  
    constructor(
  
      private readonly reconciliationService:
        PaymentReconciliationService,
  
    ) {
  
      super();
  
    }
  
    async process(
      job: Job,
    ) {
  
      switch (
        job.name
      ) {
  
        case
          'reconcile-pending-payments':
  
          await this
            .reconciliationService
            .reconcilePendingPayments();
  
          break;
  
      }
  
    }
  
  }