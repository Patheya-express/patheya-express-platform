import {
    Global,
    Module,
  } from '@nestjs/common';
  
  import { RealtimeGateway }
  from './gateways/realtime.gateway';
  
  import { RealtimeService }
  from './services/realtime.service';
  
  @Global()
  @Module({
  
    providers: [
  
      RealtimeGateway,
  
      RealtimeService,
  
    ],
  
    exports: [
  
      RealtimeService,
  
    ],
  
  })
  export class RealtimeModule {}