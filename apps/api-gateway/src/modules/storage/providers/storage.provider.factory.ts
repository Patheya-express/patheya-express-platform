import { ConfigService } from '@nestjs/config';

import {
  STORAGE_PROVIDER,
  StorageDriver,
} from '../constants/storage.constants';

import { LocalStorageProvider } from './local-storage.provider';

import { S3StorageProvider } from './s3-storage.provider';

export const StorageProviderFactory = {
  provide: STORAGE_PROVIDER,

  inject: [ConfigService, LocalStorageProvider, S3StorageProvider],

  useFactory: (
    config: ConfigService,
    localProvider: LocalStorageProvider,
    s3Provider: S3StorageProvider,
  ) => {
    const driver = config.get<string>('storage.driver', StorageDriver.LOCAL);

    switch (driver) {
      case StorageDriver.S3:
        return s3Provider;

      default:
        return localProvider;
    }
  },
};
