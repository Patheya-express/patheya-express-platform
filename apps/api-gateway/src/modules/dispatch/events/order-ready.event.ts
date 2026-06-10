export class OrderReadyEvent {

    constructor(
  
      public readonly orderId:
        string,
  
      public readonly restaurantId:
        string,
  
    ) {}
  
  }