import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { UserRole, UserStatus } from '@prisma/client';

import { UsersRepository } from '../repositories/users.repository';

import { UpdateProfileDto } from '../dto/update-profile.dto';
import { GetUsersQueryDto } from '../dto/get-users-query.dto';
import { PaginatedUsersResponseDto } from '../dto/paginated-users-response.dto';

function toSafeUser(user: any) {
  const { passwordHash, ...safeUser } = user;
  return safeUser;
}

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  async getProfile(userId: string) {
    const user = await this.usersRepository.findById(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return toSafeUser(user);
  }

  async updateProfile(
    userId: string,

    dto: UpdateProfileDto,
  ) {
    const updatedUser = await this.usersRepository.updateProfile(
      userId,

      dto,
    );

    return toSafeUser(updatedUser);
  }

  async getAllUsers(query: GetUsersQueryDto): Promise<PaginatedUsersResponseDto> {
    const skip = (query.page - 1) * query.limit;

    const { items, total } = await this.usersRepository.findAllUsers({
      skip,

      take: query.limit,

      search: query.search,

      role: query.role,

      status: query.status,
    });

    return {
      items: items.map((user) => toSafeUser(user)),

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

    const updated = await this.usersRepository.updateStatus(targetUserId, UserStatus.ACTIVE);

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

    const updated = await this.usersRepository.updateStatus(targetUserId, UserStatus.SUSPENDED);

    return toSafeUser(updated);
  }

  async restoreUser(targetUserId: string) {
    const target = await this.usersRepository.findById(targetUserId);

    if (!target) {
      throw new NotFoundException('User not found');
    }

    if (target.status !== UserStatus.SUSPENDED && target.status !== UserStatus.BLOCKED) {
      throw new BadRequestException('Only suspended or blocked users can be restored');
    }

    const updated = await this.usersRepository.updateStatus(targetUserId, UserStatus.ACTIVE);

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

    const updated = await this.usersRepository.updateStatus(targetUserId, UserStatus.BLOCKED);

    return toSafeUser(updated);
  }
}
