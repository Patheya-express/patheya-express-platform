import {

    Injectable,
  
    NestInterceptor,
  
    ExecutionContext,
  
    CallHandler,
  
  } from '@nestjs/common';
  
  import {
  
    Observable,
  
    tap,
  
  } from 'rxjs';
  
  import { AppLoggerService }
  from '../../infrastructure/logger/logger.service';
  
  @Injectable()
  export class LoggingInterceptor
  implements NestInterceptor {
  
    constructor(
  
      private readonly logger:
        AppLoggerService,
  
    ) {}
  
    intercept(
  
      context:
        ExecutionContext,
  
      next:
        CallHandler,
  
    ): Observable<any> {
  
      const request =
  
        context
          .switchToHttp()
          .getRequest();
  
      const method =
        request.method;
  
      const url =
        request.originalUrl;
  
      const requestId =
        request.requestId;
  
      const start =
        Date.now();
  
      return next.handle().pipe(
  
        tap(() => {
  
          const duration =
  
            Date.now() -
            start;
  
            this.logger.log(

              {
            
                requestId,
            
                method,
            
                url,
            
                duration,
            
                statusCode:
                  request.res?.statusCode,
            
              },
            
              'HTTP',
            
            );
  
        }),
  
      );
  
    }
  
  }