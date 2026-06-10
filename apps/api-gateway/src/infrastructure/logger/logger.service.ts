import {
  Injectable,
  LoggerService,
} from '@nestjs/common';

import { winstonConfig }
from './logger.config';

@Injectable()
export class AppLoggerService
implements LoggerService {

  log(
    message: string,
    context?: string,
  ) {

    winstonConfig.info({

      context,

      message,

    });

  }

  error(

    message: string,

    trace?: string,

    context?: string,

  ) {

    winstonConfig.error({

      context,

      message,

      trace,

    });

  }

  warn(
    message: string,
    context?: string,
  ) {

    winstonConfig.warn({

      context,

      message,

    });

  }

  debug(
    message: string,
    context?: string,
  ) {

    winstonConfig.debug({

      context,

      message,

    });

  }

  verbose(
    message: string,
    context?: string,
  ) {

    winstonConfig.verbose({

      context,

      message,

    });

  }

}