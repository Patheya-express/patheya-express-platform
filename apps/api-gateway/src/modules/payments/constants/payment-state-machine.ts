import { TransactionStatus } from '@prisma/client';

export const PAYMENT_STATE_MACHINE: Record<
  TransactionStatus,
  TransactionStatus[]
> = {
  [TransactionStatus.PENDING]: [
    TransactionStatus.SUCCESS,
    TransactionStatus.FAILED,
  ],

  [TransactionStatus.SUCCESS]: [TransactionStatus.REFUNDED],

  [TransactionStatus.FAILED]: [],

  [TransactionStatus.REFUNDED]: [],
};

/**
 * Inverse of PAYMENT_STATE_MACHINE — every status a payment may legally be transitioning FROM to
 * land on `target`. Used to build the atomic claim's `WHERE status IN (...)` clause (see
 * PaymentsRepository.claimStatusTransition / PaymentsService.transitionPaymentStatus): a
 * conditional UPDATE that only succeeds if the row is currently in one of these states closes the
 * check-then-act race between the client-driven verify call and the Razorpay webhook (or two
 * concurrent deliveries of either) landing on the same payment at once, without needing a
 * SERIALIZABLE transaction or advisory lock — the same "conditional update as atomic claim"
 * pattern already used by CouponsRepository.reserveRedemption and
 * WalletRepository.applyToOrderAtomic.
 */
export function getAllowedSourceStatuses(
  target: TransactionStatus,
): TransactionStatus[] {
  return (Object.keys(PAYMENT_STATE_MACHINE) as TransactionStatus[]).filter(
    (from) => PAYMENT_STATE_MACHINE[from].includes(target),
  );
}
