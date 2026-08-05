import { Global, Module } from '@nestjs/common';

import { AppLoggerService } from './logger.service';

import { RequestContextService } from '../../common/request-context/request-context.service';

@Global()
@Module({
  providers: [AppLoggerService, RequestContextService],

  exports: [AppLoggerService, RequestContextService],
})
export class LoggerModule {}
