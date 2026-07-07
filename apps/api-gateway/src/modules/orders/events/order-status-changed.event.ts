export class OrderStatusChangedEvent {
  constructor(
    public readonly orderId: string,

    public readonly customerId: string,

    public readonly status: string,
  ) {}
}
