import {
    Injectable,
  } from '@nestjs/common';
  
  @Injectable()
  export class RequestContextService {
  
    private requestId:
      string;
  
    setRequestId(
      requestId: string,
    ) {
  
      this.requestId =
        requestId;
  
    }
  
    getRequestId() {
  
      return this.requestId;
  
    }
  
  }