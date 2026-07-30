import { Injectable, LoggerService } from '@nestjs/common';

import { winstonConfig } from './logger.config';
import { redactSensitiveFields } from './redact.util';

/** Every structured log call goes through this — see redact.util.ts for exactly what's redacted
 *  and why. `context`/`trace` are passed through unredacted (always plain strings supplied by
 *  the call site itself, e.g. a class name), only the caller-supplied payload is scanned. */
function redactedPayload(message: unknown): Record<string, unknown> {
  const payload: Record<string, unknown> =
    typeof message === 'object' && message !== null
      ? (message as Record<string, unknown>)
      : { message };

  return redactSensitiveFields(payload) as Record<string, unknown>;
}

@Injectable()
export class AppLoggerService implements LoggerService {
  log(message: any, context?: string) {
    winstonConfig.info({
      context,

      ...redactedPayload(message),
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

      ...redactedPayload(message),
    });
  }

  warn(message: any, context?: string) {
    winstonConfig.warn({
      context,

      ...redactedPayload(message),
    });
  }

  debug(message: any, context?: string) {
    winstonConfig.debug({
      context,

      ...redactedPayload(message),
    });
  }

  verbose(message: any, context?: string) {
    winstonConfig.verbose({
      context,

      ...redactedPayload(message),
    });
  }
}
