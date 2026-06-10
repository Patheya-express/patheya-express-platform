import {
    Injectable,
  } from '@nestjs/common';
  
  import {
    LocalStorageProvider,
  } from '../providers/local-storage.provider';
import { UploadFile } from 'src/shared/types/upload-file.type';
  
  @Injectable()
  export class StorageService {
  
    constructor(
  
      private readonly provider:
        LocalStorageProvider,
  
    ) {}
  
    async upload(
  
      file: UploadFile,
  
      folder: string,
  
    ) {
  
      return this.provider.upload(
        file,
        folder,
      );
  
    }
  
    async delete(
      key: string,
    ) {
  
      return this.provider.delete(
        key,
      );
  
    }
  
  }