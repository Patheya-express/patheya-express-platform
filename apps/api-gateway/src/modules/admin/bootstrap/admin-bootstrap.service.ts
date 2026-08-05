import { Injectable, OnApplicationBootstrap } from '@nestjs/common';

import { ConfigService } from '@nestjs/config';

import { AuthProvider, Prisma, UserRole, UserStatus } from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import { AppLoggerService } from '../../../infrastructure/logger/logger.service';

import { PasswordService } from '../../auth/services/password.service';

interface SuperAdminBootstrapConfig {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone: string;
}

const REQUIRED_ENV_VARS = [
  'SUPER_ADMIN_EMAIL',
  'SUPER_ADMIN_PASSWORD',
  'SUPER_ADMIN_FIRST_NAME',
  'SUPER_ADMIN_LAST_NAME',
  'SUPER_ADMIN_PHONE',
] as const;

/**
 * Creates the platform's first SUPER_ADMIN automatically on startup, if one doesn't already
 * exist — there is deliberately no API endpoint anywhere that can create a SUPER_ADMIN; this is
 * the only path, and it only ever runs from inside the process itself.
 *
 * Runs via `OnApplicationBootstrap` rather than `OnModuleInit`: Nest fires
 * `onApplicationBootstrap` hooks only after every module's `onModuleInit` has resolved across the
 * whole graph, which guarantees `PrismaService.onModuleInit()`'s `$connect()` has already
 * succeeded before this service ever queries the database — regardless of where
 * `AdminBootstrapModule` sits in `AppModule`'s import order.
 */
@Injectable()
export class AdminBootstrapService implements OnApplicationBootstrap {
  constructor(
    private readonly prisma: PrismaService,

    private readonly config: ConfigService,

    private readonly passwordService: PasswordService,

    private readonly logger: AppLoggerService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const bootstrapConfig = this.loadConfig();

    if (!bootstrapConfig) {
      return;
    }

    try {
      await this.createSuperAdminIfMissing(bootstrapConfig);
    } catch (error) {
      // A failed bootstrap must never crash application startup — log it as a structured error
      // (with stack trace, no secrets) and let the rest of the app continue booting normally.
      this.logger.error(
        {
          event: 'super_admin_bootstrap_failed',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        error instanceof Error ? error.stack : undefined,
        'AdminBootstrapService',
      );
    }
  }

  /**
   * All five SUPER_ADMIN_* variables are mandatory for bootstrap to run at all. Missing any of
   * them is logged and skips bootstrap entirely — it never throws, so an environment that hasn't
   * configured these yet (e.g. a fresh QA deploy before the operator fills them in) still starts
   * up normally, just without a bootstrapped SUPER_ADMIN.
   */
  private loadConfig(): SuperAdminBootstrapConfig | undefined {
    const values: Record<
      (typeof REQUIRED_ENV_VARS)[number],
      string | undefined
    > = {
      SUPER_ADMIN_EMAIL: this.config.get<string>('SUPER_ADMIN_EMAIL'),
      SUPER_ADMIN_PASSWORD: this.config.get<string>('SUPER_ADMIN_PASSWORD'),
      SUPER_ADMIN_FIRST_NAME: this.config.get<string>('SUPER_ADMIN_FIRST_NAME'),
      SUPER_ADMIN_LAST_NAME: this.config.get<string>('SUPER_ADMIN_LAST_NAME'),
      SUPER_ADMIN_PHONE: this.config.get<string>('SUPER_ADMIN_PHONE'),
    };

    const missing = REQUIRED_ENV_VARS.filter((key) => !values[key]);

    if (missing.length > 0) {
      this.logger.error(
        {
          event: 'super_admin_bootstrap_skipped',
          reason: 'missing_required_environment_variables',
          missing,
        },
        undefined,
        'AdminBootstrapService',
      );

      return undefined;
    }

    return {
      email: values.SUPER_ADMIN_EMAIL!,
      password: values.SUPER_ADMIN_PASSWORD!,
      firstName: values.SUPER_ADMIN_FIRST_NAME!,
      lastName: values.SUPER_ADMIN_LAST_NAME!,
      phone: values.SUPER_ADMIN_PHONE!,
    };
  }

  /**
   * Atomic check-and-create, guarded two ways against concurrent bootstrap (e.g. Render/
   * Kubernetes starting several replicas of this process at once):
   *
   *  1. A `Serializable` transaction — Postgres guarantees that of two concurrent transactions
   *     both reading "does a SUPER_ADMIN exist?" and then writing based on that read, at most one
   *     can commit; every other one fails with a serialization error (Prisma P2034) rather than
   *     both succeeding.
   *  2. `User.email`'s own `@unique` constraint (`schema.prisma`) — an independent backstop: even
   *     if every instance shares the same `SUPER_ADMIN_EMAIL` (the normal case across replicas of
   *     one deployment), only the first `create` can ever succeed; every other fails with P2002.
   *
   * Both failure codes are treated identically to "already exists" below — neither is a crash,
   * and neither results in a second SUPER_ADMIN.
   */
  private async createSuperAdminIfMissing(
    bootstrapConfig: SuperAdminBootstrapConfig,
  ): Promise<void> {
    try {
      const created = await this.prisma.$transaction(
        async (tx) => {
          const existing = await tx.user.findFirst({
            where: {
              role: UserRole.SUPER_ADMIN,

              status: UserStatus.ACTIVE,

              deletedAt: null,
            },

            select: { id: true },
          });

          if (existing) {
            return null;
          }

          const passwordHash = await this.passwordService.hashPassword(
            bootstrapConfig.password,
          );

          return tx.user.create({
            data: {
              firstName: bootstrapConfig.firstName,

              lastName: bootstrapConfig.lastName,

              email: bootstrapConfig.email,

              phone: bootstrapConfig.phone,

              passwordHash,

              role: UserRole.SUPER_ADMIN,

              status: UserStatus.ACTIVE,

              provider: AuthProvider.EMAIL,

              isEmailVerified: true,

              isPhoneVerified: true,

              // createdAt/updatedAt are left to Prisma's own @default(now())/@updatedAt — no
              // creation path elsewhere in this codebase sets them explicitly either.
            },

            select: { id: true, email: true },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      if (!created) {
        this.logger.log(
          { event: 'super_admin_already_exists' },
          'AdminBootstrapService',
        );

        return;
      }

      this.logger.log(
        {
          event: 'super_admin_created',

          // Production Readiness Stage D (Logging Audit): logs userId, not email — matching
          // AuthService's own convention elsewhere (register/login log userId, never email).
          // `email` isn't in redact.util.ts's redaction pattern, so it would have passed through
          // to the log sink unredacted.
          userId: created.id,

          role: UserRole.SUPER_ADMIN,
        },
        'AdminBootstrapService',
      );
    } catch (error) {
      if (this.isConcurrentCreationConflict(error)) {
        // Another instance won the race — the expected, benign outcome of concurrent bootstrap
        // across multiple replicas starting at once, not an error.
        this.logger.log(
          {
            event: 'super_admin_already_exists',

            note: 'detected via a concurrent creation conflict from another instance, not the initial existence check',
          },
          'AdminBootstrapService',
        );

        return;
      }

      throw error;
    }
  }

  /** P2002 = unique constraint violation (email); P2034 = serialization/deadlock failure under a
   *  Serializable transaction. Both mean "another instance already created the row." */
  private isConcurrentCreationConflict(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === 'P2002' || error.code === 'P2034')
    );
  }
}
