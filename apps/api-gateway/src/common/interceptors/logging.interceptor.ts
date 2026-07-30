import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';

import { Observable, finalize, tap } from 'rxjs';

import { AppLoggerService } from '../../infrastructure/logger/logger.service';

import { MetricsService } from '../../modules/metrics/metrics.service';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(
    private readonly logger: AppLoggerService,

    // Optional so this interceptor's existing manual `new LoggingInterceptor(logger)`
    // instantiation in any as-yet-unmigrated bootstrap keeps working without the metrics arg.
    private readonly metrics?: MetricsService,
  ) {}

  intercept(
    context: ExecutionContext,

    next: CallHandler,
  ): Observable<any> {
    const request = context.switchToHttp().getRequest();

    const method = request.method;

    const url = request.originalUrl;

    const requestId = request.requestId;

    const start = Date.now();

    this.metrics?.incrementInFlightRequests();

    return next.handle().pipe(
      finalize(() => {
        this.metrics?.decrementInFlightRequests();
      }),
      tap(() => {
        const duration = Date.now() - start;

        const statusCode = request.res?.statusCode;

        this.logger.log(
          {
            requestId,

            method,

            url,

            duration,

            statusCode,
          },

          'HTTP',
        );

        // Route, not raw URL — `:id`-shaped path params keep the label's cardinality bounded
        // (platform-standards.md Section 12's naming convention assumes a finite label set, which
        // a raw URL containing UUIDs would violate).
        const route: string = request.route?.path || url;

        this.metrics?.observeHttpRequest(
          method,
          route,
          statusCode,
          duration / 1000,
        );
      }),
    );
  }
}
