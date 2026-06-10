export class DeliveryPartnerAssignedEvent {

    constructor(
  
      public readonly orderId: string,
  
      public readonly customerId: string,
  
      public readonly partnerUserId: string,
  
    ) {}
  
  }