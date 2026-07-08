import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

import {
  UserRole,
  UserStatus,
  AuditAction,
  User,
  NotificationPreference,
} from '@prisma/client';

import { UsersRepository } from '../repositories/users.repository';

import { UpdateProfileDto } from '../dto/update-profile.dto';
import { GetUsersQueryDto } from '../dto/get-users-query.dto';
import { PaginatedUsersResponseDto } from '../dto/paginated-users-response.dto';
import { UserResponseDto } from '../dto/user-response.dto';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { UpdatePreferencesDto } from '../dto/update-preferences.dto';
import { NotificationPreferencesResponseDto } from '../dto/notification-preferences-response.dto';

import { PasswordService } from '../../auth/services/password.service';
import { AuthService } from '../../auth/services/auth.service';
import { AuditService } from '../../audit/services/audit.service';
import { StorageService } from '../../storage/services/storage.service';
import type { UploadFile } from '../../../shared/types/upload-file.type';

const PROFILE_COMPLETION_FIELDS = [
  'lastName',
  'email',
  'phone',
  'avatarUrl',
] as const;

const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferencesResponseDto = {
  orderUpdatesEmail: true,
  orderUpdatesSms: true,
  orderUpdatesPush: true,
  promotionsEmail: false,
  promotionsSms: false,
  promotionsPush: false,
  reviewsEmail: true,
  reviewsSms: false,
  reviewsPush: true,
  systemEmail: true,
  systemSms: false,
  systemPush: true,
};

type SafeUser = Omit<User, 'passwordHash'>;

function toSafeUser(user: User): Omit<User, 'passwordHash'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { passwordHash, ...safeUser } = user;
  return safeUser;
}

function computeProfileCompletion(user: SafeUser): number {
  const filled = PROFILE_COMPLETION_FIELDS.filter((field) =>
    Boolean(user[field]),
  ).length;
  return Math.round((filled / PROFILE_COMPLETION_FIELDS.length) * 100);
}

function toProfileResponse(user: SafeUser) {
  return {
    ...user,
    profileCompletion: computeProfileCompletion(user),
  };
}

function toPreferencesResponse(
  prefs: NotificationPreference,
): NotificationPreferencesResponseDto {
  return {
    orderUpdatesEmail: prefs.orderUpdatesEmail,
    orderUpdatesSms: prefs.orderUpdatesSms,
    orderUpdatesPush: prefs.orderUpdatesPush,
    promotionsEmail: prefs.promotionsEmail,
    promotionsSms: prefs.promotionsSms,
    promotionsPush: prefs.promotionsPush,
    reviewsEmail: prefs.reviewsEmail,
    reviewsSms: prefs.reviewsSms,
    reviewsPush: prefs.reviewsPush,
    systemEmail: prefs.systemEmail,
    systemSms: prefs.systemSms,
    systemPush: prefs.systemPush,
  };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly passwordService: PasswordService,
    private readonly authService: AuthService,
    private readonly auditService: AuditService,
    private readonly storageService: StorageService,
  ) {}

  async getProfile(userId: string) {
    const user = await this.usersRepository.findById(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return toProfileResponse(user);
  }

  async updateProfile(
    userId: string,

    dto: UpdateProfileDto,
  ) {
    const updatedUser = await this.usersRepository.updateProfile(
      userId,

      dto,
    );

    return toProfileResponse(updatedUser);
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.usersRepository.findByIdWithPassword(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.passwordHash) {
      throw new BadRequestException(
        'Password login is not enabled for this account',
      );
    }

    const isCurrentPasswordValid = await this.passwordService.comparePassword(
      dto.currentPassword,
      user.passwordHash,
    );

    if (!isCurrentPasswordValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const newPasswordHash = await this.passwordService.hashPassword(
      dto.newPassword,
    );

    await this.usersRepository.updatePassword(userId, newPasswordHash);

    await this.auditService.log(
      userId,
      'User',
      userId,
      AuditAction.UPDATE,
      null,
      { action: 'password_changed' },
    );

    return { success: true };
  }

  async uploadAvatar(userId: string, file: UploadFile) {
    const user = await this.usersRepository.findById(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const avatarUrl = await this.storageService.upload(file, 'users/avatars');

    const updated = await this.usersRepository.updateAvatar(userId, avatarUrl);

    return toProfileResponse(updated);
  }

  async getPreferences(
    userId: string,
  ): Promise<NotificationPreferencesResponseDto> {
    const prefs = await this.usersRepository.getNotificationPreferences(userId);

    return prefs
      ? toPreferencesResponse(prefs)
      : DEFAULT_NOTIFICATION_PREFERENCES;
  }

  async updatePreferences(
    userId: string,

    dto: UpdatePreferencesDto,
  ): Promise<NotificationPreferencesResponseDto> {
    const updated = await this.usersRepository.upsertNotificationPreferences(
      userId,

      dto,
    );

    return toPreferencesResponse(updated);
  }

  async deleteAccount(userId: string) {
    const user = await this.usersRepository.findById(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.usersRepository.softDeleteAccount(userId);

    await this.authService.revokeAllRefreshTokens(userId);

    await this.auditService.log(
      userId,
      'User',
      userId,
      AuditAction.DELETE,
      null,
      null,
    );

    return { success: true };
  }

  async getAllUsers(
    query: GetUsersQueryDto,
  ): Promise<PaginatedUsersResponseDto> {
    const skip = (query.page - 1) * query.limit;

    const { items, total } = await this.usersRepository.findAllUsers({
      skip,

      take: query.limit,

      search: query.search,

      role: query.role,

      status: query.status,
    });

    return {
      // Prisma nullable fields type as `T | null`; UserResponseDto declares them `T | undefined`
      // (Swagger's `?` convention). Same values flow through either way at runtime — this is a
      // type-level reconciliation only, not a behavior change.
      items: items as unknown as UserResponseDto[],

      total,

      page: query.page,

      limit: query.limit,

      totalPages: Math.ceil(total / query.limit),
    };
  }

  async countByRole(role: UserRole): Promise<number> {
    return this.usersRepository.countByRole(role);
  }

  async activateUser(targetUserId: string) {
    const target = await this.usersRepository.findById(targetUserId);

    if (!target) {
      throw new NotFoundException('User not found');
    }

    if (target.status !== UserStatus.INACTIVE) {
      throw new BadRequestException('Only inactive users can be activated');
    }

    const updated = await this.usersRepository.updateStatus(
      targetUserId,
      UserStatus.ACTIVE,
    );

    return toSafeUser(updated);
  }

  async suspendUser(targetUserId: string, actingUserId: string) {
    if (targetUserId === actingUserId) {
      throw new ForbiddenException('You cannot suspend your own account');
    }

    const target = await this.usersRepository.findById(targetUserId);

    if (!target) {
      throw new NotFoundException('User not found');
    }

    // Super admin accounts can never be suspended through this endpoint. This is the
    // stricter superset of "at least one active super admin must remain" — since no super
    // admin can ever be suspended, that invariant holds unconditionally as a consequence.
    if (target.role === UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Super admin accounts cannot be suspended');
    }

    if (target.status !== UserStatus.ACTIVE) {
      throw new BadRequestException('Only active users can be suspended');
    }

    const updated = await this.usersRepository.updateStatus(
      targetUserId,
      UserStatus.SUSPENDED,
    );

    return toSafeUser(updated);
  }

  async restoreUser(targetUserId: string) {
    const target = await this.usersRepository.findById(targetUserId);

    if (!target) {
      throw new NotFoundException('User not found');
    }

    if (
      target.status !== UserStatus.SUSPENDED &&
      target.status !== UserStatus.BLOCKED
    ) {
      throw new BadRequestException(
        'Only suspended or blocked users can be restored',
      );
    }

    const updated = await this.usersRepository.updateStatus(
      targetUserId,
      UserStatus.ACTIVE,
    );

    return toSafeUser(updated);
  }

  /**
   * The only path into UserStatus.BLOCKED — suspendUser()/restoreUser() never set it, they
   * only ever transition out of it (restoreUser already handles BLOCKED -> ACTIVE). Same
   * self-block and super-admin protections as suspendUser().
   */
  async blockUser(targetUserId: string, actingUserId: string) {
    if (targetUserId === actingUserId) {
      throw new ForbiddenException('You cannot block your own account');
    }

    const target = await this.usersRepository.findById(targetUserId);

    if (!target) {
      throw new NotFoundException('User not found');
    }

    if (target.role === UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Super admin accounts cannot be blocked');
    }

    if (target.status === UserStatus.BLOCKED) {
      throw new BadRequestException('User is already blocked');
    }

    const updated = await this.usersRepository.updateStatus(
      targetUserId,
      UserStatus.BLOCKED,
    );

    return toSafeUser(updated);
  }
}
