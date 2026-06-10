import {
    Global,
    Module,
  } from '@nestjs/common';
  
  import {
    StorageService,
  } from './services/storage.service';
  
  import {
    LocalStorageProvider,
  } from './providers/local-storage.provider';
  
  @Global()
  @Module({
  
    providers: [
  
      StorageService,
  
      LocalStorageProvider,
  
    ],
  
    exports: [
  
      StorageService,
  
    ],
  
  })
  export class StorageModule {}