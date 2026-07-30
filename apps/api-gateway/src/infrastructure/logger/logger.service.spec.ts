jest.mock('./logger.config', () => ({
  winstonConfig: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
  },
}));

import { AppLoggerService } from './logger.service';
import { winstonConfig } from './logger.config';

/** Sprint 1.6 — proves AppLoggerService actually applies redaction before anything reaches
 *  Winston (and therefore stdout/logs/combined.log), for every log level, not just that
 *  redact.util.ts's function works in isolation. */
describe('AppLoggerService — redaction', () => {
  let logger: AppLoggerService;

  beforeEach(() => {
    jest.clearAllMocks();
    logger = new AppLoggerService();
  });

  it('log() redacts sensitive fields before reaching Winston', () => {
    logger.log(
      { event: 'auth_login_success', password: 'hunter2' },
      'AuthService',
    );

    expect(winstonConfig.info).toHaveBeenCalledWith({
      context: 'AuthService',
      event: 'auth_login_success',
      password: '[REDACTED]',
    });
  });

  it('error() redacts the message payload but leaves the trace/context strings untouched', () => {
    logger.error(
      { event: 'payment_failed', razorpay_signature: 'abc123' },
      'Error: stack trace here',
      'PaymentsService',
    );

    expect(winstonConfig.error).toHaveBeenCalledWith({
      context: 'PaymentsService',
      trace: 'Error: stack trace here',
      event: 'payment_failed',
      razorpay_signature: '[REDACTED]',
    });
  });

  it('warn()/debug()/verbose() all redact too', () => {
    logger.warn({ token: 'abc' }, 'Ctx');
    logger.debug({ token: 'abc' }, 'Ctx');
    logger.verbose({ token: 'abc' }, 'Ctx');

    expect(winstonConfig.warn).toHaveBeenCalledWith({
      context: 'Ctx',
      token: '[REDACTED]',
    });
    expect(winstonConfig.debug).toHaveBeenCalledWith({
      context: 'Ctx',
      token: '[REDACTED]',
    });
    expect(winstonConfig.verbose).toHaveBeenCalledWith({
      context: 'Ctx',
      token: '[REDACTED]',
    });
  });

  it('a plain string message is wrapped and passed through unredacted (no key to match against)', () => {
    logger.log('Application started');

    expect(winstonConfig.info).toHaveBeenCalledWith({
      context: undefined,
      message: 'Application started',
    });
  });

  it('does not redact ordinary diagnostic fields (requestId, orderId, statusCode, ...)', () => {
    logger.log(
      { requestId: 'req-1', orderId: 'order-1', statusCode: 200, duration: 42 },
      'HTTP',
    );

    expect(winstonConfig.info).toHaveBeenCalledWith({
      context: 'HTTP',
      requestId: 'req-1',
      orderId: 'order-1',
      statusCode: 200,
      duration: 42,
    });
  });
});
