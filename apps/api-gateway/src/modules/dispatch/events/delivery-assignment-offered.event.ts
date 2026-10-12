/**
 * Published (topic `delivery.assignment.offered`) after a delivery assignment offer has been
 * committed — by DispatchService.assignOrder (automatic) and AdminDispatchService (manual).
 * Ids only: subscribers must re-read authoritative state rather than trust this payload.
 */
export class DeliveryAssignmentOfferedEvent {
  constructor(
    public readonly assignmentId: string,

    public readonly orderId: string,

    public readonly partnerUserId: string,
  ) {}
}
