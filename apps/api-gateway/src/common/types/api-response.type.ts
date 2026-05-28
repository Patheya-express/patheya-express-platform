export interface ApiResponse<T> {

    success: boolean;
  
    timestamp: string;
  
    data: T;
  
  }