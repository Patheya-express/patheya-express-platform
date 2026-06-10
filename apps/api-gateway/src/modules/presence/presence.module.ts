import {
    Module,
  } from '@nestjs/common';
  
  import { PresenceController }
  from './controllers/presence.controller';
  
  import { PresenceService }
  from './services/presence.service';
  
  @Module({
  
    controllers: [
  
      PresenceController,
  
    ],
  
    providers: [
  
      PresenceService,
  
    ],
  
    exports: [
  
      PresenceService,
  
    ],
  
  })
  export class PresenceModule {}