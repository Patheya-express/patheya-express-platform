import * as winston from 'winston';

// File transports write to the container's local (ephemeral, pod-local) disk with no rotation —
// fine for local development, wrong in Kubernetes where logs should go to stdout only and be
// collected by the cluster's logging agent. Defaults to 'true' so today's local-dev behavior is
// unchanged; K8s manifests set LOG_TO_FILE=false.
const logToFile = process.env.LOG_TO_FILE !== 'false';

export const winstonConfig = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',

  format: winston.format.combine(
    winston.format.timestamp(),

    winston.format.errors({
      stack: true,
    }),

    winston.format.json(),
  ),

  transports: [
    new winston.transports.Console(),

    ...(logToFile
      ? [
          new winston.transports.File({
            filename: 'logs/error.log',

            level: 'error',
          }),

          new winston.transports.File({
            filename: 'logs/combined.log',
          }),
        ]
      : []),
  ],
});
