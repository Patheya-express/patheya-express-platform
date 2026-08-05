import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

import { Request, Response } from 'express';

import { AppLoggerService } from '../../infrastructure/logger/logger.service';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: AppLoggerService) {}

  catch(
    exception: unknown,

    host: ArgumentsHost,
  ) {
    const ctx = host.switchToHttp();

    const response = ctx.getResponse<Response>();

    const request = ctx.getRequest<Request>();

    const status: number =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.message
        : 'Internal server error';

    const logPayload = {
      requestId: request['requestId'],

      method: request.method,

      path: request.url,

      statusCode: status,

      message,

      // The response body only ever exposes the generic message above — this is the only
      // place the real cause of a non-HttpException (i.e. an unexpected 500) is recoverable.
      ...(exception instanceof HttpException
        ? {}
        : {
            cause:
              exception instanceof Error
                ? exception.message
                : String(exception),
          }),
    };

    // Production Readiness Stage D (Logging Audit): previously logged every exception at ERROR
    // unconditionally — an expected, routine 4xx (bad password, invalid DTO, 404, a webhook with
    // a bad signature) was indistinguishable in log volume/severity from a genuine 5xx
    // application fault, which both double-counts every occurrence the throwing service site
    // already logged at its own appropriate level, and would desensitize any alert keyed off
    // ERROR-level log rate under real traffic. Only a genuine server fault (5xx, or anything that
    // isn't even a recognized HttpException) logs at ERROR with a stack trace here now.
    // 500, not HttpStatus.INTERNAL_SERVER_ERROR — comparing a plain `number` against a specific
    // enum member trips @typescript-eslint/no-unsafe-enum-comparison; a literal here is both
    // lint-clean and unambiguous (matches the numeric threshold's own well-known meaning).
    if (status >= 500) {
      this.logger.error(
        logPayload,
        exception instanceof Error ? exception.stack : undefined,
        'EXCEPTION',
      );
    } else {
      this.logger.warn(logPayload, 'EXCEPTION');
    }

    response.status(status).json({
      success: false,

      statusCode: status,

      path: request.url,

      timestamp: new Date().toISOString(),

      message,
    });
  }
}
