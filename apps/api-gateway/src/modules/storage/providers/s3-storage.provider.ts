import { Injectable } from '@nestjs/common';

import { ConfigService } from '@nestjs/config';

import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import { StorageProvider } from '../interfaces/storage-provider.interface';

import { UploadFile } from '../../../shared/types/upload-file.type';

interface S3Config {
  bucket?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  endpoint?: string;
  publicBaseUrl?: string;
}

/**
 * Production-ready S3-compatible provider (also works against R2/MinIO/Spaces via a custom
 * `endpoint`). Config is read lazily per-call rather than cached at construction time so a
 * missing/incomplete config fails with a clear error only when S3 is actually used — mirroring
 * how BANK_ACCOUNT_ENCRYPTION_KEY is validated at the crypto call site rather than at boot.
 */
@Injectable()
export class S3StorageProvider implements StorageProvider {
  constructor(private readonly config: ConfigService) {}

  async upload(file: UploadFile, folder: string): Promise<string> {
    const { bucket, publicBaseUrl } = this.requireConfig();

    const key = `${folder}/${Date.now()}-${sanitizeFileName(file.originalname)}`;

    await this.client().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
      }),
    );

    return `${publicBaseUrl}/${key}`;
  }

  async delete(key: string): Promise<void> {
    const { bucket, publicBaseUrl } = this.requireConfig();

    const objectKey = key.startsWith(publicBaseUrl)
      ? key.slice(publicBaseUrl.length + 1)
      : key;

    await this.client().send(
      new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }),
    );
  }

  private client(): S3Client {
    const { region, accessKeyId, secretAccessKey, endpoint } =
      this.requireConfig();

    return new S3Client({
      region,
      endpoint,
      // A custom endpoint (R2/MinIO/Spaces) needs path-style addressing; real AWS S3 doesn't.
      forcePathStyle: !!endpoint,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  private requireConfig(): Required<Omit<S3Config, 'endpoint'>> & {
    endpoint?: string;
  } {
    const raw = this.config.get<S3Config>('storage.s3') ?? {};

    const missing = (
      ['bucket', 'region', 'accessKeyId', 'secretAccessKey'] as const
    ).filter((key) => !raw[key]);

    if (missing.length > 0) {
      throw new Error(
        `S3 storage is not configured — missing: ${missing
          .map((key) => `S3_${toEnvCase(key)}`)
          .join(', ')}.`,
      );
    }

    return {
      bucket: raw.bucket!,
      region: raw.region!,
      accessKeyId: raw.accessKeyId!,
      secretAccessKey: raw.secretAccessKey!,
      endpoint: raw.endpoint,
      publicBaseUrl:
        raw.publicBaseUrl ??
        raw.endpoint ??
        `https://${raw.bucket}.s3.${raw.region}.amazonaws.com`,
    };
  }
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
}

function toEnvCase(camel: string): string {
  return camel.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase();
}
