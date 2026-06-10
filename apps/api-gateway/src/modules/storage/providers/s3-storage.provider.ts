import {
    Injectable,
  } from '@nestjs/common';
  
  import {
    StorageProvider,
  } from '../interfaces/storage-provider.interface';
  
  import { UploadFile }
  from '../../../shared/types/upload-file.type';
  
  @Injectable()
  export class S3StorageProvider
  implements StorageProvider {
  
    async upload(
      file: UploadFile,
      folder: string,
    ): Promise<string> {
  
      throw new Error(
        'S3 storage not configured',
      );
  
    }
  
    async delete(
      key: string,
    ): Promise<void> {
  
      throw new Error(
        'S3 storage not configured',
      );
  
    }
  
  }