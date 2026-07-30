import { Injectable, LoggerService, Optional } from '@nestjs/common';

import { winstonConfig } from './logger.config';
import { redactSensitiveFields } from './redact.util';
import { RequestContextService } from '../../common/request-context/request-context.service';

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
  constructor(
    // Optional so logger.service.spec.ts's `new AppLoggerService()` (no args) keeps working —
    // only the real DI-constructed instance (via the @Global() LoggerModule) has this available.
    @Optional()
    private readonly requestContext?: RequestContextService,
  ) {}

  /** Merges the current request's correlation ID (if any — e.g. a BullMQ worker log has none)
   *  into every log line, without requiring any of this codebase's existing log call sites to
   *  pass it explicitly. A call site's own explicit `requestId` field always wins. */
  private withRequestId(payload: Record<string, unknown>): Record<string, unknown> {
    const requestId = this.requestContext?.getRequestId();

    if (requestId === undefined || payload.requestId !== undefined) {
      return payload;
    }

    return { requestId, ...payload };
  }

  log(message: any, context?: string) {
    winstonConfig.info({
      context,

      ...this.withRequestId(redactedPayload(message)),
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

      ...this.withRequestId(redactedPayload(message)),
    });
  }

  warn(message: any, context?: string) {
    winstonConfig.warn({
      context,

      ...this.withRequestId(redactedPayload(message)),
    });
  }

  debug(message: any, context?: string) {
    winstonConfig.debug({
      context,

      ...this.withRequestId(redactedPayload(message)),
    });
  }

  verbose(message: any, context?: string) {
    winstonConfig.verbose({
      context,

      ...this.withRequestId(redactedPayload(message)),
    });
  }
}
