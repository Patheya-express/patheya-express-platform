import { Injectable } from '@nestjs/common';

import { AsyncLocalStorage } from 'async_hooks';

interface RequestContextStore {
  requestId: string;
}

/**
 * Production Readiness Stage B (Observability): this class previously held `requestId` as a
 * plain instance field on a singleton provider — since Nest instantiates providers once and
 * reuses them across every concurrent request, that field was overwritten by whichever request
 * called `setRequestId` most recently, and was never actually wired to anything (grep confirms no
 * import anywhere in src/ before this change). `AsyncLocalStorage` is Node's own mechanism for
 * exactly this "ambient per-request context, readable anywhere in that request's async call
 * chain without threading it through every function signature" problem, and doesn't leak across
 * concurrent requests the way the old field did.
 */
@Injectable()
export class RequestContextService {
  private readonly storage = new AsyncLocalStorage<RequestContextStore>();

  run<T>(requestId: string, callback: () => T): T {
    return this.storage.run({ requestId }, callback);
  }

  getRequestId(): string | undefined {
    return this.storage.getStore()?.requestId;
  }
}
