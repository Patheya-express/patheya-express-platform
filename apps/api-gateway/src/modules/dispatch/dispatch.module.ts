import {
    Module,
  } from '@nestjs/common';
  
  import { DispatchController }
  from './controllers/dispatch.controller';
  
  import { DispatchService }
  from './services/dispatch.service';
  
  import { DispatchRepository }
  from './repositories/dispatch.repository';
  
  import { DispatchListener }
  from './listeners/dispatch.listener';
import { PresenceModule } from '../presence/presence.module';
  
  @Module({
    imports: [
        PresenceModule
      ],
  
    controllers: [
  
      DispatchController,
  
    ],
  
    providers: [
  
      DispatchService,
  
      DispatchRepository,
  
      DispatchListener,
  
    ],
  
    exports: [
  
      DispatchService,

      DispatchRepository
  
    ],
  
  })
  export class DispatchModule {}