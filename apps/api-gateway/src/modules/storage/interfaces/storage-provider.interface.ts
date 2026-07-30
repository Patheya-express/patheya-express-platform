import { UploadFile } from '../../../shared/types/upload-file.type';

/**
 * Rich upload metadata every provider returns, beyond just the URL. Fields that don't apply to a
 * given provider (e.g. `width`/`height` for a non-image local upload) are simply omitted —
 * callers that only need the URL keep using `StorageService.upload()`, which stays
 * backward-compatible and returns `Promise<string>` as it always has.
 */
export interface UploadResult {
  url: string;
  publicId?: string;
  secureUrl?: string;
  width?: number;
  height?: number;
  bytes?: number;
  format?: string;
  resourceType?: string;
  folder?: string;
  version?: string | number;
  createdAt?: string;
}

export interface StorageProvider {
  upload(file: UploadFile, folder: string): Promise<UploadResult>;

  /** Uploads `file` in place of `existingKey` (same public identity where the provider supports
   *  it, e.g. Cloudinary's `public_id` overwrite) — used when a document/media item is replaced
   *  rather than added as a new item. */
  replace(
    file: UploadFile,
    folder: string,
    existingKey: string,
  ): Promise<UploadResult>;

  delete(key: string): Promise<void>;

  exists(key: string): Promise<boolean>;

  /** Resolves `key` (whatever `upload()`/`replace()` returned as `url`) to a fetchable URL —
   *  a no-op passthrough for providers whose `url` is already directly fetchable. */
  getUrl(key: string): string;

  /** Cheap reachability check for the readiness probe — no live network call for
   *  Cloudinary (config-presence only), a local filesystem write-access check for Local. */
  checkHealth(): Promise<boolean>;
}
