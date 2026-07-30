import { Module } from '@nestjs/common';

import { SystemController } from './controllers/system.controller';
import { PresenceModule } from '../presence/presence.module';

@Module({
  imports: [PresenceModule],

  controllers: [SystemController],
})
export class SystemModule {}
