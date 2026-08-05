import { Injectable, NestMiddleware } from '@nestjs/common';

import { Request, Response, NextFunction } from 'express';

import { v4 as uuidv4 } from 'uuid';

import { RequestContextService } from '../request-context/request-context.service';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  constructor(private readonly requestContext: RequestContextService) {}

  use(
    req: Request,

    res: Response,

    next: NextFunction,
  ) {
    const requestId = (req.headers['x-request-id'] as string) || uuidv4();

    req['requestId'] = requestId;

    res.setHeader(
      'x-request-id',

      requestId,
    );

    // Establishes the AsyncLocalStorage context for this request's entire async call chain —
    // every awaited service/repository call downstream of `next()` can read this requestId via
    // RequestContextService.getRequestId() without it being threaded through as a parameter.
    this.requestContext.run(requestId, next);
  }
}
