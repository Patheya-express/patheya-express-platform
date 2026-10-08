import { timingSafeEqual } from 'crypto';

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * `/metrics` is internal observability (Prometheus exposition: queue depths, route latencies,
 * dispatch/payment counters). Production ECS has no scraper, and the ALB forwards every path to
 * the API — so in production it is answered only for:
 *  - loopback peers — an operator inside the task (ECS Exec: `curl localhost:3000/metrics`).
 *    Uses the raw TCP peer (`socket.remoteAddress`), never `req.ip`/X-Forwarded-For, so it cannot
 *    be spoofed through the ALB (whose connections always arrive from a VPC address). This relies
 *    on there being no in-task reverse proxy: if a sidecar (Service Connect, Envoy, ...) is ever
 *    added in front of the app, every request becomes loopback and this exemption must go;
 *  - callers presenting `Authorization: Bearer <METRICS_AUTH_TOKEN>`, when that token is
 *    configured (for a future scraper).
 * Everyone else gets 404, so the endpoint's existence is not advertised. Non-production
 * environments are unchanged (open), which keeps local Prometheus/k8s scraping and
 * scripts/smoke-test.ts working there.
 */
@Injectable()
export class MetricsAccessGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.config.get<string>('app.nodeEnv') !== 'production') {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();

    if (LOOPBACK_ADDRESSES.has(request.socket?.remoteAddress ?? '')) {
      return true;
    }

    const token = this.config.get<string>('metrics.authToken');
    const header = request.headers?.authorization;
    if (token && typeof header === 'string' && header.startsWith('Bearer ')) {
      const presented = Buffer.from(header.slice('Bearer '.length));
      const expected = Buffer.from(token);
      if (
        presented.length === expected.length &&
        timingSafeEqual(presented, expected)
      ) {
        return true;
      }
    }

    throw new NotFoundException();
  }
}
