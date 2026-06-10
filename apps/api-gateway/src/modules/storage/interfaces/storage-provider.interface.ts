import { UploadFile }
from '../../../shared/types/upload-file.type';
export interface StorageProvider {

    upload(
  
      file: UploadFile,
  
      folder: string,
  
    ): Promise<string>;
  
    delete(
      key: string,
    ): Promise<void>;
  
  }