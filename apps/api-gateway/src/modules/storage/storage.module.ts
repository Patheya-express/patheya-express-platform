import {
  Global,
  Module,
} from '@nestjs/common';

import {
  ConfigModule,
} from '@nestjs/config';

import {
  StorageService,
} from './services/storage.service';

import {
  LocalStorageProvider,
} from './providers/local-storage.provider';

import {
  S3StorageProvider,
} from './providers/s3-storage.provider';

import {
  StorageProviderFactory,
} from './providers/storage.provider.factory';

@Global()
@Module({

  imports: [
    ConfigModule,
  ],

  providers: [

    StorageService,

    LocalStorageProvider,

    S3StorageProvider,

    StorageProviderFactory,

  ],

  exports: [
    StorageService,
  ],

})
export class StorageModule {}