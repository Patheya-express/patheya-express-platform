import { Global, Module } from '@nestjs/common';

import { ConfigModule } from '@nestjs/config';

import { StorageService } from './services/storage.service';

import { LocalStorageProvider } from './providers/local-storage.provider';

import { CloudinaryStorageProvider } from './providers/cloudinary-storage.provider';

import { StorageProviderFactory } from './providers/storage.provider.factory';

@Global()
@Module({
  imports: [ConfigModule],

  providers: [
    StorageService,

    LocalStorageProvider,

    CloudinaryStorageProvider,

    StorageProviderFactory,
  ],

  exports: [StorageService],
})
export class StorageModule {}
