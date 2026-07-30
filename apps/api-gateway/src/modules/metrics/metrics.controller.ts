import { Controller, Get, Header } from '@nestjs/common';

import { SkipThrottle } from '@nestjs/throttler';

import { MetricsService } from './metrics.service';

/**
 * Deliberately at `/metrics`, not `/api/v1/metrics` — Prometheus scrape convention, and matches
 * where every other exporter in this platform (pgbouncer, nginx-ingress, etc.,
 * modules/observability/servicemonitors.tf) already publishes. Excluded from the global `api/v1`
 * prefix in main.ts/worker-main.ts's `setGlobalPrefix` call.
 */
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @SkipThrottle()
  // prom-client's own default registry content-type (Registry.PROMETHEUS_CONTENT_TYPE) — static
  // here rather than read from the registry at request time since `@Header` requires a literal.
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async getMetrics(): Promise<string> {
    return this.metrics.getMetrics();
  }
}
