import { Inject, Injectable } from '@nestjs/common';

import { STORAGE_PROVIDER } from '../constants/storage.constants';

import type {
  StorageProvider,
  UploadResult,
} from '../interfaces/storage-provider.interface';

import { UploadFile } from 'src/shared/types/upload-file.type';

@Injectable()
export class StorageService {
  constructor(
    @Inject(STORAGE_PROVIDER)
    private readonly provider: StorageProvider,
  ) {}

  /** Unchanged signature/behavior — every existing upload endpoint keeps calling this exactly
   *  as before, unaware of which provider (local/Cloudinary) is behind it. */
  async upload(
    file: UploadFile,

    folder: string,
  ): Promise<string> {
    const result = await this.provider.upload(file, folder);

    return result.url;
  }

  /** Same upload, but returns the full provider metadata (publicId, dimensions, bytes, format,
   *  etc.) rather than just the URL — for callers that want to persist richer data going
   *  forward. Existing callers are unaffected; nothing requires migrating to this. */
  async uploadWithMetadata(
    file: UploadFile,

    folder: string,
  ): Promise<UploadResult> {
    return this.provider.upload(file, folder);
  }

  async replace(
    file: UploadFile,
    folder: string,
    existingKey: string,
  ): Promise<string> {
    const result = await this.provider.replace(file, folder, existingKey);

    return result.url;
  }

  async replaceWithMetadata(
    file: UploadFile,
    folder: string,
    existingKey: string,
  ): Promise<UploadResult> {
    return this.provider.replace(file, folder, existingKey);
  }

  async delete(key: string) {
    return this.provider.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.provider.exists(key);
  }

  getUrl(key: string): string {
    return this.provider.getUrl(key);
  }

  async checkHealth(): Promise<boolean> {
    return this.provider.checkHealth();
  }
}
