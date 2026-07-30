import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  StreamableFile,
} from '@nestjs/common';

import { Observable } from 'rxjs';

import { map } from 'rxjs/operators';

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(
    context: ExecutionContext,

    next: CallHandler,
  ): Observable<any> {
    const request = context.switchToHttp().getRequest();

    return next.handle().pipe(
      map((data) => {
        // StreamableFile responses (file downloads) must reach Nest's built-in stream
        // handling untouched — wrapping one in the envelope turns it into a plain object,
        // which Nest can no longer recognize as a stream, and the file body gets
        // JSON-serialized instead of streamed.
        if (data instanceof StreamableFile) {
          return data;
        }

        // Prometheus scrapes /metrics expecting raw exposition-format text. Wrapping it in
        // the {success,timestamp,data} envelope turns every metric line into one escaped JSON
        // string field — not valid exposition format, so a real Prometheus server can't parse
        // it at all (confirmed via a live scrape during Stage B verification).
        if (request.path === '/metrics') {
          return data;
        }

        return {
          success: true,

          timestamp: new Date().toISOString(),

          data,
        };
      }),
    );
  }
}
