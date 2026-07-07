import { ConflictException } from '@nestjs/common';

import { TransactionStatus } from '@prisma/client';

import { PAYMENT_STATE_MACHINE } from '../constants/payment-state-machine';

export class PaymentStatusValidator {
  static validateTransition(
    currentStatus: TransactionStatus,

    nextStatus: TransactionStatus,
  ) {
    const allowedStatuses = PAYMENT_STATE_MACHINE[currentStatus];

    if (!allowedStatuses.includes(nextStatus)) {
      throw new ConflictException(
        `Invalid payment status transition: ${currentStatus} -> ${nextStatus}`,
      );
    }
  }
}
