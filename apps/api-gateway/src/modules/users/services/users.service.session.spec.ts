import { BadRequestException, ForbiddenException } from '@nestjs/common';

import { UserRole, UserStatus } from '@prisma/client';

import { UsersService } from './users.service';

/**
 * Sprint 1.4 — suspendUser/blockUser must kill every existing session for the account, not just
 * flip the DB status column (see UsersService.revokeAllSessions's doc comment for why three
 * separate mechanisms are needed). restoreUser must undo the Redis side of that. Only these four
 * methods are under test — the rest of UsersService is unchanged by this sprint.
 */
describe('UsersService — session revocation on suspend/block/restore', () => {
  let usersRepository: { findById: jest.Mock; updateStatus: jest.Mock };
  let authService: { revokeAllRefreshTokens: jest.Mock };
  let auditService: { log: jest.Mock };
  let realtimeService: { disconnectUser: jest.Mock };
  let redisService: { set: jest.Mock; del: jest.Mock };
  let service: UsersService;

  function buildUser(
    overrides: Partial<{ id: string; role: UserRole; status: UserStatus }> = {},
  ) {
    return {
      id: 'target-1',
      role: UserRole.CUSTOMER,
      status: UserStatus.ACTIVE,
      ...overrides,
    };
  }

  beforeEach(() => {
    usersRepository = {
      findById: jest.fn(),
      updateStatus: jest
        .fn()
        .mockImplementation((id: string, status: UserStatus) =>
          Promise.resolve(buildUser({ id, status })),
        ),
    };
    authService = {
      revokeAllRefreshTokens: jest.fn().mockResolvedValue(undefined),
    };
    auditService = { log: jest.fn().mockResolvedValue(undefined) };
    realtimeService = { disconnectUser: jest.fn() };
    redisService = {
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };

    service = new UsersService(
      usersRepository as any,
      {} as any, // passwordService — unused
      authService as any,
      auditService as any,
      {} as any, // storageService — unused
      realtimeService as any,
      redisService as any,
    );
  });

  describe('suspendUser', () => {
    it('revokes all refresh tokens, sets the Redis blocked flag, and force-disconnects live sockets', async () => {
      usersRepository.findById.mockResolvedValue(buildUser());

      await service.suspendUser('target-1', 'admin-1');

      expect(authService.revokeAllRefreshTokens).toHaveBeenCalledWith(
        'target-1',
      );
      expect(redisService.set).toHaveBeenCalledWith(
        'auth:blocked:target-1',
        '1',
      );
      expect(realtimeService.disconnectUser).toHaveBeenCalledWith('target-1');
    });

    it('still suspends the account even if Redis is unavailable — the refresh-token revocation already happened', async () => {
      usersRepository.findById.mockResolvedValue(buildUser());
      redisService.set.mockRejectedValue(new Error('Redis connection refused'));

      await expect(
        service.suspendUser('target-1', 'admin-1'),
      ).resolves.toBeDefined();

      expect(authService.revokeAllRefreshTokens).toHaveBeenCalled();
      expect(realtimeService.disconnectUser).toHaveBeenCalled();
    });

    it('rejects suspending your own account before touching any session state', async () => {
      await expect(service.suspendUser('admin-1', 'admin-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(authService.revokeAllRefreshTokens).not.toHaveBeenCalled();
    });

    it('rejects suspending an already-inactive-or-suspended user without revoking anything', async () => {
      usersRepository.findById.mockResolvedValue(
        buildUser({ status: UserStatus.SUSPENDED }),
      );

      await expect(service.suspendUser('target-1', 'admin-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(authService.revokeAllRefreshTokens).not.toHaveBeenCalled();
    });
  });

  describe('blockUser', () => {
    it('revokes all refresh tokens, sets the Redis blocked flag, and force-disconnects live sockets', async () => {
      usersRepository.findById.mockResolvedValue(buildUser());

      await service.blockUser('target-1', 'admin-1');

      expect(authService.revokeAllRefreshTokens).toHaveBeenCalledWith(
        'target-1',
      );
      expect(redisService.set).toHaveBeenCalledWith(
        'auth:blocked:target-1',
        '1',
      );
      expect(realtimeService.disconnectUser).toHaveBeenCalledWith('target-1');
    });
  });

  describe('restoreUser', () => {
    it('clears the Redis blocked flag when restoring a suspended user', async () => {
      usersRepository.findById.mockResolvedValue(
        buildUser({ status: UserStatus.SUSPENDED }),
      );

      await service.restoreUser('target-1', 'admin-1');

      expect(redisService.del).toHaveBeenCalledWith('auth:blocked:target-1');
    });

    it('clears the Redis blocked flag when restoring a blocked user', async () => {
      usersRepository.findById.mockResolvedValue(
        buildUser({ status: UserStatus.BLOCKED }),
      );

      await service.restoreUser('target-1', 'admin-1');

      expect(redisService.del).toHaveBeenCalledWith('auth:blocked:target-1');
    });
  });
});
