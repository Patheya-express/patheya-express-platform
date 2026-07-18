import { ConfigService } from '@nestjs/config';

import {
  STORAGE_PROVIDER,
  StorageDriver,
} from '../constants/storage.constants';

import { LocalStorageProvider } from './local-storage.provider';

import { CloudinaryStorageProvider } from './cloudinary-storage.provider';

export const StorageProviderFactory = {
  provide: STORAGE_PROVIDER,

  inject: [ConfigService, LocalStorageProvider, CloudinaryStorageProvider],

  useFactory: (
    config: ConfigService,
    localProvider: LocalStorageProvider,
    cloudinaryProvider: CloudinaryStorageProvider,
  ) => {
    const driver = config.get<StorageDriver>(
      'storage.driver',
      StorageDriver.LOCAL,
    );

    switch (driver) {
      case StorageDriver.CLOUDINARY:
        return cloudinaryProvider;

      default:
        return localProvider;
    }
  },
};
