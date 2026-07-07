import { Inject, Injectable } from '@nestjs/common';

import { STORAGE_PROVIDER } from '../constants/storage.constants';

import type { StorageProvider } from '../interfaces/storage-provider.interface';

import { UploadFile } from 'src/shared/types/upload-file.type';

@Injectable()
export class StorageService {
  constructor(
    @Inject(STORAGE_PROVIDER)
    private readonly provider: StorageProvider,
  ) {}

  async upload(
    file: UploadFile,

    folder: string,
  ) {
    return this.provider.upload(file, folder);
  }

  async delete(key: string) {
    return this.provider.delete(key);
  }
}
