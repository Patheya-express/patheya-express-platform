import * as winston
from 'winston';

export const winstonConfig =
  winston.createLogger({

    level: 'info',

    format:
      winston.format.combine(

        winston.format.timestamp(),

        winston.format.errors({
          stack: true,
        }),

        winston.format.json(),

      ),

    transports: [

      new winston
        .transports.Console(),

    ],

  });