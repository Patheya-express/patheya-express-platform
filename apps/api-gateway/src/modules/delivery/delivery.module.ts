import {
    Module,
  } from '@nestjs/common';
  
  import { DeliveryController }
  from './controllers/delivery.controller';
  
  import { DeliveryService }
  from './services/delivery.service';
  
  import { DeliveryRepository }
  from './repositories/delivery.repository';
  
  @Module({
  
    controllers: [
      DeliveryController,
    ],
  
    providers: [
  
      DeliveryService,
  
      DeliveryRepository,
  
    ],
  
  })
  export class DeliveryModule {}