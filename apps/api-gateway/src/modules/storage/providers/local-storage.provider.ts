import { Injectable } from '@nestjs/common';

import * as fs from 'fs';

import * as path from 'path';

import { StorageProvider } from '../interfaces/storage-provider.interface';
import { UploadFile } from 'src/shared/types/upload-file.type';

@Injectable()
export class LocalStorageProvider implements StorageProvider {
  async upload(
    file: UploadFile,

    folder: string,
  ): Promise<string> {
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

    return `/uploads/${folder}/${fileName}`;
  }

  async delete(key: string): Promise<void> {
    const filePath = path.join(process.cwd(), key);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}
