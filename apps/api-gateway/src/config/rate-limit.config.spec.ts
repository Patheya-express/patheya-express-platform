import { Server } from 'http';

import { Controller, Get, INestApplication } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';

import configuration from './configuration';
import { envValidationSchema } from './env.validation';
import {
  DEFAULT_RATE_LIMIT_MAX,
  RATE_LIMIT_MAX_UPPER_BOUND,
  RATE_LIMIT_TTL_MS,
  buildThrottlerOptions,
  parseRateLimitMax,
} from './rate-limit.config';

describe('rate limit configuration (RATE_LIMIT_MAX)', () => {
  describe('parseRateLimitMax', () => {
    it('defaults to 100 when unset or blank', () => {
      expect(DEFAULT_RATE_LIMIT_MAX).toBe(100);
      expect(parseRateLimitMax(undefined)).toBe(100);
      expect(parseRateLimitMax('')).toBe(100);
      expect(parseRateLimitMax('   ')).toBe(100);
    });

    it('accepts a valid override', () => {
      expect(parseRateLimitMax('60000')).toBe(60000);
      expect(parseRateLimitMax(' 250 ')).toBe(250);
      expect(parseRateLimitMax('1')).toBe(1);
      expect(parseRateLimitMax(String(RATE_LIMIT_MAX_UPPER_BOUND))).toBe(
        RATE_LIMIT_MAX_UPPER_BOUND,
      );
    });

    it.each(['0', '-5', '1.5', 'abc', '100x', 'Infinity', 'NaN', '100001'])(
      'rejects invalid value %p instead of guessing',
      (raw) => {
        expect(() => parseRateLimitMax(raw)).toThrow(/RATE_LIMIT_MAX/);
      },
    );
  });

  describe('configuration() factory', () => {
    const original = process.env.RATE_LIMIT_MAX;
    afterEach(() => {
      if (original === undefined) delete process.env.RATE_LIMIT_MAX;
      else process.env.RATE_LIMIT_MAX = original;
    });

    it('exposes rateLimit.max = 100 by default', () => {
      delete process.env.RATE_LIMIT_MAX;
      expect(configuration().rateLimit.max).toBe(100);
    });

    it('exposes the override when RATE_LIMIT_MAX is set', () => {
      process.env.RATE_LIMIT_MAX = '60000';
      expect(configuration().rateLimit.max).toBe(60000);
    });

    it('fails to load (boot fails) on an invalid value', () => {
      process.env.RATE_LIMIT_MAX = 'unlimited';
      expect(() => configuration()).toThrow(/RATE_LIMIT_MAX/);
    });
  });

  describe('env validation', () => {
    const BASE = {
      NODE_ENV: 'development',
      PORT: 3000,
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/patheya_dev',
      REDIS_HOST: 'localhost',
      REDIS_PORT: 6379,
      JWT_ACCESS_SECRET: 'dev-access-secret',
      JWT_REFRESH_SECRET: 'dev-refresh-secret',
      KAFKA_BROKER: 'localhost:9092',
    };
    const validate = (extra: Record<string, unknown>) =>
      envValidationSchema.validate({ ...BASE, ...extra }).error;

    it('accepts unset, blank and valid values', () => {
      expect(validate({})).toBeUndefined();
      expect(validate({ RATE_LIMIT_MAX: '' })).toBeUndefined();
      expect(validate({ RATE_LIMIT_MAX: '60000' })).toBeUndefined();
    });

    it.each(['0', '-1', '2.5', 'abc', '100001'])('rejects %p', (value) => {
      expect(validate({ RATE_LIMIT_MAX: value })).toBeDefined();
    });
  });

  describe('buildThrottlerOptions', () => {
    it('uses rateLimit.max with the fixed 60 s window', () => {
      const config = new ConfigService({ rateLimit: { max: 250 } });
      expect(buildThrottlerOptions(config)).toEqual([
        { name: 'default', ttl: RATE_LIMIT_TTL_MS, limit: 250 },
      ]);
    });

    it('falls back to 100 if the config value is absent', () => {
      expect(buildThrottlerOptions(new ConfigService({}))).toEqual([
        { name: 'default', ttl: 60_000, limit: 100 },
      ]);
    });
  });

  describe('enforcement (ThrottlerGuard wired exactly like AppModule)', () => {
    @Controller('probe')
    class ProbeController {
      @Get()
      get() {
        return 'ok';
      }
    }

    async function appWithLimit(max: number): Promise<INestApplication> {
      const moduleRef = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            isGlobal: true, // as in AppModule
            ignoreEnvFile: true,
            load: [() => ({ rateLimit: { max } })],
          }),
          ThrottlerModule.forRootAsync({
            inject: [ConfigService],
            useFactory: buildThrottlerOptions,
          }),
        ],
        controllers: [ProbeController],
        providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
      }).compile();
      const app = moduleRef.createNestApplication();
      await app.init();
      return app;
    }

    it('still enforces the configured limit (an override is not a bypass)', async () => {
      const app = await appWithLimit(3);
      const server = app.getHttpServer() as Server;
      try {
        for (let i = 0; i < 3; i++) {
          await request(server).get('/probe').expect(200);
        }
        await request(server).get('/probe').expect(429);
      } finally {
        await app.close();
      }
    });
  });
});
