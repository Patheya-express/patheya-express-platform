import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import { MediaRepository } from '../repositories/media.repository';

import { UploadMediaDto } from '../dto/upload-media.dto';

import { StorageService } from '../../storage/services/storage.service';
import { UploadFile } from '../../../shared/types/upload-file.type';

import {
  AuthenticatedUser,
  canAccessRestaurant,
  hasRestaurantRole,
} from '../../../shared/authorization/order-access.util';

const MANAGE_ROLES = ['OWNER', 'CO_OWNER', 'ADMIN'] as const;

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaRepository: MediaRepository,
    private readonly storageService: StorageService,
  ) {}

  async findAll(restaurantId: string) {
    return this.mediaRepository.findManyByRestaurant(restaurantId);
  }

  async upload(
    restaurantId: string,
    dto: UploadMediaDto,
    file: UploadFile,
    user: AuthenticatedUser,
  ) {
    if (!(await canAccessRestaurant(this.prisma, restaurantId, user))) {
      throw new ForbiddenException(
        'You do not have permission to upload media for this restaurant',
      );
    }

    const url = await this.storageService.upload(file, 'restaurants/media');
    const nextSortOrder =
      await this.mediaRepository.countByRestaurant(restaurantId);

    return this.mediaRepository.create({
      restaurantId,
      branchId: dto.branchId,
      type: dto.type,
      url,
      uploadedById: user.userId,
      sortOrder: nextSortOrder,
    });
  }

  async remove(restaurantId: string, mediaId: string, user: AuthenticatedUser) {
    const media = await this.mediaRepository.findById(mediaId);

    if (!media || media.restaurantId !== restaurantId) {
      throw new NotFoundException('Media not found');
    }

    if (
      !(await hasRestaurantRole(this.prisma, restaurantId, user, [
        ...MANAGE_ROLES,
      ]))
    ) {
      throw new ForbiddenException(
        'You do not have permission to remove media for this restaurant',
      );
    }

    await this.storageService.delete(media.url).catch(() => {
      // Best-effort — the DB row is still removed even if the underlying file is already gone.
    });

    return this.mediaRepository.delete(mediaId);
  }

  async reorder(
    restaurantId: string,
    mediaIds: string[],
    user: AuthenticatedUser,
  ) {
    if (
      !(await hasRestaurantRole(this.prisma, restaurantId, user, [
        ...MANAGE_ROLES,
      ]))
    ) {
      throw new ForbiddenException(
        'You do not have permission to reorder media for this restaurant',
      );
    }

    const existing =
      await this.mediaRepository.findManyByRestaurant(restaurantId);
    const existingIds = new Set(existing.map((item) => item.id));

    const invalid = mediaIds.filter((id) => !existingIds.has(id));

    if (invalid.length > 0) {
      throw new NotFoundException(`Media not found: ${invalid.join(', ')}`);
    }

    await this.mediaRepository.reorder(
      mediaIds.map((id, index) => ({ id, sortOrder: index })),
    );

    return this.mediaRepository.findManyByRestaurant(restaurantId);
  }
}
