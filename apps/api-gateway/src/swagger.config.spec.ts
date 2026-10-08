import { isSwaggerEnabled } from './swagger.config';

describe('isSwaggerEnabled (/api/docs exposure)', () => {
  it('is off in production by default', () => {
    expect(isSwaggerEnabled('production', undefined)).toBe(false);
    expect(isSwaggerEnabled('production', '')).toBe(false);
  });

  it.each(['development', 'staging', undefined])(
    'is on by default outside production (%p)',
    (nodeEnv) => {
      expect(isSwaggerEnabled(nodeEnv, undefined)).toBe(true);
    },
  );

  it('can be explicitly enabled in production', () => {
    expect(isSwaggerEnabled('production', 'true')).toBe(true);
    expect(isSwaggerEnabled('production', ' TRUE ')).toBe(true);
  });

  it('can be explicitly disabled anywhere', () => {
    expect(isSwaggerEnabled('development', 'false')).toBe(false);
  });

  it('ignores unrecognised values and keeps the safe default', () => {
    expect(isSwaggerEnabled('production', 'yes')).toBe(false);
  });
});
