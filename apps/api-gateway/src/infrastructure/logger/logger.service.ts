import { Injectable, LoggerService } from '@nestjs/common';

import { winstonConfig } from './logger.config';

@Injectable()
export class AppLoggerService implements LoggerService {
  log(message: any, context?: string) {
    winstonConfig.info({
      context,

      ...(typeof message === 'object' ? message : { message }),
    });
  }

  error(
    message: any,

    trace?: string,

    context?: string,
  ) {
    winstonConfig.error({
      context,

      trace,

      ...(typeof message === 'object' ? message : { message }),
    });
  }

  warn(message: any, context?: string) {
    winstonConfig.warn({
      context,

      ...(typeof message === 'object' ? message : { message }),
    });
  }

  debug(message: any, context?: string) {
    winstonConfig.debug({
      context,

      ...(typeof message === 'object' ? message : { message }),
    });
  }

  verbose(message: any, context?: string) {
    winstonConfig.verbose({
      context,

      ...(typeof message === 'object' ? message : { message }),
    });
  }
}
