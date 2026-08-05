import { Global, Module } from '@nestjs/common';

import { JwtModule } from '@nestjs/jwt';

import { RealtimeGateway } from './gateways/realtime.gateway';

import { RealtimeService } from './services/realtime.service';

import { RedisInfrastructureModule } from '../../infrastructure/redis-infrastructure/redis-infrastructure.module';

@Global()
@Module({
  imports: [JwtModule.register({}), RedisInfrastructureModule],

  providers: [RealtimeGateway, RealtimeService],

  exports: [RealtimeService],
})
export class RealtimeModule {}
