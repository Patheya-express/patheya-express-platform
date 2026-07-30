import { Injectable } from '@nestjs/common';

import { ConfigService } from '@nestjs/config';

import { Readable } from 'stream';

import {
  v2 as cloudinary,
  UploadApiOptions,
  UploadApiResponse,
} from 'cloudinary';

import {
  StorageProvider,
  UploadResult,
} from '../interfaces/storage-provider.interface';
import { UploadFile } from '../../../shared/types/upload-file.type';
import { CLOUDINARY_ROOT_FOLDER } from '../constants/storage.constants';

interface CloudinaryConfig {
  cloudName?: string;
  apiKey?: string;
  apiSecret?: string;
}

/**
 * Config is read lazily per-call (not cached at construction time) so a missing/incomplete
 * config fails clearly only when Cloudinary is actually used — mirroring S3StorageProvider's
 * original design (which this replaces) and BANK_ACCOUNT_ENCRYPTION_KEY's validate-at-call-site
 * pattern.
 */
@Injectable()
export class CloudinaryStorageProvider implements StorageProvider {
  constructor(private readonly config: ConfigService) {}

  async upload(file: UploadFile, folder: string): Promise<UploadResult> {
    this.configure();

    const response = await this.uploadBuffer(file, {
      folder: `${CLOUDINARY_ROOT_FOLDER}/${folder}`,
      resource_type: 'auto',
      overwrite: true,
    });

    return toUploadResult(response, folder);
  }

  /** Overwrites the same Cloudinary asset in place (same `public_id`) rather than creating a new
   *  one — `existingKey` is whatever `upload()`/`replace()` previously returned as `url`. */
  async replace(
    file: UploadFile,
    folder: string,
    existingKey: string,
  ): Promise<UploadResult> {
    this.configure();

    const publicId = toPublicId(existingKey);

    const response = await this.uploadBuffer(file, {
      folder: `${CLOUDINARY_ROOT_FOLDER}/${folder}`,
      public_id: publicId ?? undefined,
      resource_type: 'auto',
      overwrite: true,
      invalidate: true,
    });

    return toUploadResult(response, folder);
  }

  async delete(key: string): Promise<void> {
    this.configure();

    const publicId = toPublicId(key);

    if (!publicId) {
      return;
    }

    // Try each resource type in turn — destroy() requires knowing the type up front and we only
    // ever persist the URL, not the type, so a not-found on one type isn't a hard failure.
    for (const resourceType of ['image', 'video', 'raw'] as const) {
      try {
        const result = (await cloudinary.uploader.destroy(publicId, {
          resource_type: resourceType,
        })) as { result?: string };

        if (result.result === 'ok') {
          return;
        }
      } catch {
        // Try the next resource type.
      }
    }
  }

  async exists(key: string): Promise<boolean> {
    this.configure();

    const publicId = toPublicId(key);

    if (!publicId) {
      return false;
    }

    for (const resourceType of ['image', 'video', 'raw'] as const) {
      try {
        await cloudinary.api.resource(publicId, {
          resource_type: resourceType,
        });
        return true;
      } catch {
        // Try the next resource type.
      }
    }

    return false;
  }

  /** Cloudinary `url`s returned by upload()/replace() are already fully-qualified secure URLs —
   *  a bare `key` (a raw public_id) is resolved via the SDK's URL builder. */
  getUrl(key: string): string {
    if (key.startsWith('http')) {
      return key;
    }

    this.configure();

    return cloudinary.url(key, { secure: true });
  }

  /** Config-presence check only — deliberately not a live Cloudinary API call, so the readiness
   *  probe stays fast and doesn't risk being rate-limited by Cloudinary on a tight probe interval. */
  async checkHealth(): Promise<boolean> {
    try {
      this.requireConfig();

      return true;
    } catch {
      return false;
    }
  }

  private uploadBuffer(
    file: UploadFile,
    options: UploadApiOptions,
  ): Promise<UploadApiResponse> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        options,
        (error, result) => {
          if (error || !result) {
            reject(
              error
                ? new Error(error.message)
                : new Error('Cloudinary upload returned no result.'),
            );
            return;
          }

          resolve(result);
        },
      );

      Readable.from(file.buffer).pipe(uploadStream);
    });
  }

  private configure(): void {
    const { cloudName, apiKey, apiSecret } = this.requireConfig();

    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true,
    });
  }

  private requireConfig(): Required<CloudinaryConfig> {
    const raw = this.config.get<CloudinaryConfig>('storage.cloudinary') ?? {};

    const missing = (['cloudName', 'apiKey', 'apiSecret'] as const).filter(
      (key) => !raw[key],
    );

    if (missing.length > 0) {
      throw new Error(
        `Cloudinary storage is not configured — missing: ${missing
          .map((key) => `CLOUDINARY_${toEnvCase(key)}`)
          .join(', ')}.`,
      );
    }

    return {
      cloudName: raw.cloudName!,
      apiKey: raw.apiKey!,
      apiSecret: raw.apiSecret!,
    };
  }
}

function toUploadResult(
  response: UploadApiResponse,
  folder: string,
): UploadResult {
  return {
    url: response.secure_url,
    publicId: response.public_id,
    secureUrl: response.secure_url,
    width: response.width,
    height: response.height,
    bytes: response.bytes,
    format: response.format,
    resourceType: response.resource_type,
    folder,
    version: response.version,
    createdAt: response.created_at,
  };
}

/**
 * Extracts the Cloudinary `public_id` (including its folder prefix) from a secure URL of the
 * form `https://res.cloudinary.com/<cloud>/<type>/upload/v<version>/<public_id>.<ext>` — every
 * existing caller persists the `url` returned by upload()/replace() as the canonical stored
 * value (mirroring how they already treat the local provider's `url`), never a bare public_id,
 * so delete()/replace()/exists() must be able to work back from that URL alone. Returns null for
 * anything that isn't a recognizable Cloudinary URL (e.g. a local `/uploads/...` path passed to
 * the wrong provider) rather than guessing.
 */
function toPublicId(urlOrPublicId: string): string | null {
  if (!urlOrPublicId.startsWith('http')) {
    return urlOrPublicId;
  }

  const uploadMarker = '/upload/';
  const markerIndex = urlOrPublicId.indexOf(uploadMarker);

  if (markerIndex === -1) {
    return null;
  }

  let rest = urlOrPublicId.slice(markerIndex + uploadMarker.length);

  // Strip an optional leading transformation segment and/or version segment (e.g. `v1699999999/`).
  const segments = rest.split('/').filter(Boolean);
  if (segments[0]?.match(/^v\d+$/)) {
    segments.shift();
  }
  rest = segments.join('/');

  const lastDotIndex = rest.lastIndexOf('.');
  return lastDotIndex === -1 ? rest : rest.slice(0, lastDotIndex);
}

function toEnvCase(camel: string): string {
  return camel.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase();
}
