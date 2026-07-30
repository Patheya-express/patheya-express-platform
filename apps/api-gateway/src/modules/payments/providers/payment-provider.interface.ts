export interface PaymentProvider {
  createOrder(amount: number, receipt: string): Promise<any>;

  verifySignature(payload: any): Promise<boolean>;

  refund(paymentId: string, amount: number): Promise<any>;
}
