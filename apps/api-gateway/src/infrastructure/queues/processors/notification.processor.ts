import {
    Processor,
    WorkerHost,
  } from '@nestjs/bullmq';
  
  import {
    Job,
  } from 'bullmq';
  
  @Processor(
    'notifications',
  )
  export class NotificationProcessor
  extends WorkerHost {
  
    async process(
      job: Job,
    ) {
  
      console.log(
        'Processing notification:',
        job.data,
      );
  
      return true;
  
    }
  
  }