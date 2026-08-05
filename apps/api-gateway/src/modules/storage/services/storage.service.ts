import { Inject, Injectable } from '@nestjs/common';

import { STORAGE_PROVIDER } from '../constants/storage.constants';

import type {
  StorageProvider,
  UploadResult,
} from '../interfaces/storage-provider.interface';

import { UploadFile } from 'src/shared/types/upload-file.type';

import { MetricsService } from '../../metrics/metrics.service';

@Injectable()
export class StorageService {
  constructor(
    @Inject(STORAGE_PROVIDER)
    private readonly provider: StorageProvider,

    private readonly metrics: MetricsService,
  ) {}

  /** Unchanged signature/behavior — every existing upload endpoint keeps calling this exactly
   *  as before, unaware of which provider (local/Cloudinary) is behind it. */
  async upload(
    file: UploadFile,

    folder: string,
  ): Promise<string> {
    const result = await this.timedUpload(() =>
      this.provider.upload(file, folder),
    );

    return result.url;
  }

  /** Same upload, but returns the full provider metadata (publicId, dimensions, bytes, format,
   *  etc.) rather than just the URL — for callers that want to persist richer data going
   *  forward. Existing callers are unaffected; nothing requires migrating to this. */
  async uploadWithMetadata(
    file: UploadFile,

    folder: string,
  ): Promise<UploadResult> {
    return this.timedUpload(() => this.provider.upload(file, folder));
  }

  async replace(
    file: UploadFile,
    folder: string,
    existingKey: string,
  ): Promise<string> {
    const result = await this.timedUpload(() =>
      this.provider.replace(file, folder, existingKey),
    );

    return result.url;
  }

  async replaceWithMetadata(
    file: UploadFile,
    folder: string,
    existingKey: string,
  ): Promise<UploadResult> {
    return this.timedUpload(() =>
      this.provider.replace(file, folder, existingKey),
    );
  }

  async delete(key: string) {
    return this.provider.delete(key);
  }

  /** `exists()` is the closest thing to a "read" operation this service has — files are served
   *  to clients directly via their stored URL (`getUrl()`), not proxied/downloaded through the
   *  backend, so there is no genuine download/fetch call anywhere in this codebase to instrument.
   *  `patheya_storage_download_failures_total` is wired here as the nearest honest proxy; it
   *  will simply stay at 0 if this path is never exercised, which is accurate, not a placeholder. */
  async exists(key: string): Promise<boolean> {
    try {
      return await this.provider.exists(key);
    } catch (error) {
      this.metrics.recordStorageDownloadFailure();
      throw error;
    }
  }

  getUrl(key: string): string {
    return this.provider.getUrl(key);
  }

  async checkHealth(): Promise<boolean> {
    return this.provider.checkHealth();
  }

  /** Shared timing/failure wrapper for `upload`/`uploadWithMetadata`/`replace`/
   *  `replaceWithMetadata` — all four are "an upload" from a metrics standpoint (`replace` is
   *  implemented as an upload-then-cleanup by the underlying providers), so one helper avoids
   *  duplicating the same try/timing logic four times. */
  private async timedUpload(
    operation: () => Promise<UploadResult>,
  ): Promise<UploadResult> {
    const start = Date.now();

    try {
      const result = await operation();

      this.metrics.observeStorageUploadDuration((Date.now() - start) / 1000);

      return result;
    } catch (error) {
      this.metrics.recordStorageUploadFailure();
      throw error;
    }
  }
}
