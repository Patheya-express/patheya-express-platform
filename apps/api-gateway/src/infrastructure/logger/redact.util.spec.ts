import { redactSensitiveFields } from './redact.util';

describe('redactSensitiveFields', () => {
  it('redacts a top-level password field', () => {
    const result = redactSensitiveFields({
      email: 'a@b.com',
      password: 'hunter2',
    });
    expect(result).toEqual({ email: 'a@b.com', password: '[REDACTED]' });
  });

  it('redacts an Authorization header regardless of casing', () => {
    const result = redactSensitiveFields({
      headers: {
        Authorization: 'Bearer abc.def.ghi',
        'content-type': 'application/json',
      },
    });
    expect(result).toEqual({
      headers: {
        Authorization: '[REDACTED]',
        'content-type': 'application/json',
      },
    });
  });

  it('redacts JWT_ACCESS_SECRET/refreshToken/accessToken/razorpay_signature-shaped keys', () => {
    const result = redactSensitiveFields({
      jwtAccessSecret: 'abc',
      refreshToken: 'def',
      accessToken: 'ghi',
      razorpay_signature: 'jkl',
      apiKey: 'mno',
      client_secret: 'pqr',
    });
    expect(result).toEqual({
      jwtAccessSecret: '[REDACTED]',
      refreshToken: '[REDACTED]',
      accessToken: '[REDACTED]',
      razorpay_signature: '[REDACTED]',
      apiKey: '[REDACTED]',
      client_secret: '[REDACTED]',
    });
  });

  it('redacts sensitive fields nested arbitrarily deep, leaving useful diagnostics untouched', () => {
    const result = redactSensitiveFields({
      event: 'payment_verified_client_side',
      paymentId: 'payment-1',
      orderId: 'order-1',
      user: { id: 'user-1', credentials: { password: 'hunter2' } },
    });
    expect(result).toEqual({
      event: 'payment_verified_client_side',
      paymentId: 'payment-1',
      orderId: 'order-1',
      user: { id: 'user-1', credentials: { password: '[REDACTED]' } },
    });
  });

  it('redacts sensitive fields inside arrays of objects', () => {
    const result = redactSensitiveFields({
      sessions: [{ name: 'session', token: 'abc123' }],
    });
    expect(result).toEqual({
      sessions: [{ name: 'session', token: '[REDACTED]' }],
    });
  });

  it('redacts a "cookies" field wholesale — a cookie value itself is sensitive, not just a named sub-field', () => {
    const result = redactSensitiveFields({
      cookies: [{ name: 'session', value: 'abc123' }],
    });
    expect(result).toEqual({ cookies: '[REDACTED]' });
  });

  it('leaves non-sensitive fields, including nested objects and dates, completely unchanged', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const input = {
      requestId: 'req-1',
      method: 'GET',
      url: '/api/v1/orders',
      duration: 42,
      statusCode: 200,
      createdAt: now,
    };
    expect(redactSensitiveFields(input)).toEqual(input);
  });

  it('does not throw on a circular reference — returns a marker instead', () => {
    const obj: Record<string, unknown> = { name: 'circular' };
    obj['self'] = obj;

    expect(() => redactSensitiveFields(obj)).not.toThrow();
    const result = redactSensitiveFields(obj) as Record<string, unknown>;
    expect(result['self']).toBe('[Circular]');
  });

  it('does not mutate the original input object', () => {
    const input = { password: 'hunter2', name: 'unchanged' };
    const copy = { ...input };
    redactSensitiveFields(input);
    expect(input).toEqual(copy);
  });

  it('passes through primitives (string, number, boolean, null, undefined) unchanged', () => {
    expect(redactSensitiveFields('a plain string')).toBe('a plain string');
    expect(redactSensitiveFields(42)).toBe(42);
    expect(redactSensitiveFields(true)).toBe(true);
    expect(redactSensitiveFields(null)).toBeNull();
    expect(redactSensitiveFields(undefined)).toBeUndefined();
  });

  it('does not choke on an Error instance passed as a field value', () => {
    const error = new Error('boom');
    const result = redactSensitiveFields({ cause: error }) as {
      cause: unknown;
    };
    expect(result.cause).toBe(error);
  });
});
