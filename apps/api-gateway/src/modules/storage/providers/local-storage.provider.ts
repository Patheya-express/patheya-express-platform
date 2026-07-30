import { Injectable } from '@nestjs/common';

import * as fs from 'fs';

import * as path from 'path';

import {
  StorageProvider,
  UploadResult,
} from '../interfaces/storage-provider.interface';
import { UploadFile } from 'src/shared/types/upload-file.type';

@Injectable()
export class LocalStorageProvider implements StorageProvider {
  upload(
    file: UploadFile,

    folder: string,
  ): Promise<UploadResult> {
    const uploadDir = path.join(
      process.cwd(),

      'uploads',

      folder,
    );

    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, {
        recursive: true,
      });
    }

    const fileName = `${Date.now()}-${file.originalname}`;

    const filePath = path.join(uploadDir, fileName);

    fs.writeFileSync(filePath, file.buffer);

    const url = `/uploads/${folder}/${fileName}`;

    return Promise.resolve({
      url,
      folder,
      bytes: file.size,
      format: path.extname(file.originalname).replace(/^\./, '') || undefined,
      createdAt: new Date().toISOString(),
    });
  }

  /** No stable "same identity" concept for local files — replacing just deletes the old file
   *  (best-effort) and writes the new one under a fresh timestamped name. */
  async replace(
    file: UploadFile,
    folder: string,
    existingKey: string,
  ): Promise<UploadResult> {
    await this.delete(existingKey).catch(() => {
      // Best-effort — proceed with the upload even if the old file was already gone.
    });

    return this.upload(file, folder);
  }

  delete(key: string): Promise<void> {
    const filePath = path.join(process.cwd(), key);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    return Promise.resolve();
  }

  exists(key: string): Promise<boolean> {
    return Promise.resolve(fs.existsSync(path.join(process.cwd(), key)));
  }

  /** Local `url`s (e.g. `/uploads/restaurants/logos/...`) are already directly fetchable —
   *  nothing to resolve. */
  getUrl(key: string): string {
    return key;
  }

  /** Mirrors upload()'s own lazy directory creation — confirms the uploads root exists and is
   *  writable rather than performing an actual write on every readiness probe. */
  async checkHealth(): Promise<boolean> {
    const uploadDir = path.join(process.cwd(), 'uploads');

    try {
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      fs.accessSync(uploadDir, fs.constants.W_OK);

      return true;
    } catch {
      return false;
    }
  }
}
