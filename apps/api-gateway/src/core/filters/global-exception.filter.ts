import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

import {
  Request,
  Response,
} from 'express';

import { AppLoggerService }
from '../../infrastructure/logger/logger.service';

@Catch()
export class GlobalExceptionFilter
implements ExceptionFilter {

  constructor(
    private readonly logger:
      AppLoggerService,
  ) {}

  catch(

    exception: unknown,

    host: ArgumentsHost,

  ) {

    const ctx =
      host.switchToHttp();

    const response =
      ctx.getResponse<Response>();

    const request =
      ctx.getRequest<Request>();

    const status =

      exception instanceof HttpException

        ? exception.getStatus()

        : HttpStatus
            .INTERNAL_SERVER_ERROR;

    const message =

      exception instanceof HttpException

        ? exception.message

        : 'Internal server error';

    this.logger.error(

      {

        requestId:
          request['requestId'],

        method:
          request.method,

        path:
          request.url,

        statusCode:
          status,

        message,

      },

      undefined,

      'EXCEPTION',

    );

    response.status(status).json({

      success: false,

      statusCode: status,

      path: request.url,

      timestamp:
        new Date().toISOString(),

      message,

    });

  }

}