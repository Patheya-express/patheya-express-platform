import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';

import { Observable, finalize, tap } from 'rxjs';

import { AppLoggerService } from '../../infrastructure/logger/logger.service';

import { MetricsService } from '../../modules/metrics/metrics.service';

/** Production Readiness Stage D (Logging Audit): k8s hits `/health/live`/`/health/ready` every
 *  10-15s per pod, forever (see the readiness/liveness probe periods in
 *  k8s/base/api-gateway/deployment.yaml), and Prometheus scrapes `/metrics` on its own interval
 *  — an unbroken stream of zero-diagnostic-value `info`-level access-log lines at any real pod
 *  count. Downgraded to `debug` (filtered out at the default `LOG_LEVEL=info`) rather than
 *  skipped outright, so they're still visible if `LOG_LEVEL=debug` is set for troubleshooting.
 *  Metrics recording below is unaffected — `patheya_http_requests_total`/`duration_seconds`
 *  still cover these routes exactly as before. */
const LOW_VALUE_ACCESS_LOG_PATHS = new Set([
  '/api/v1/health/live',
  '/api/v1/health/ready',
  '/metrics',
]);

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

        const logMethod = LOW_VALUE_ACCESS_LOG_PATHS.has(url)
          ? this.logger.debug.bind(this.logger)
          : this.logger.log.bind(this.logger);

        logMethod(
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
