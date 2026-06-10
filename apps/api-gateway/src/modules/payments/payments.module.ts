import {
    Module,
  } from '@nestjs/common';
  
  import { PaymentsController }
  from './controllers/payments.controller';
  
  import { PaymentsService }
  from './services/payments.service';
  
  import { PaymentsRepository }
  from './repositories/payments.repository';
  
  import { RazorpayProvider }
  from './providers/razorpay.provider';
  
  @Module({
  
    controllers: [
  
      PaymentsController,
  
    ],
  
    providers: [
  
      PaymentsService,
  
      PaymentsRepository,
  
      RazorpayProvider,
  
    ],
  
    exports: [
  
      PaymentsService,
  
    ],
  
  })
  export class PaymentsModule {}