import {
    TransactionStatus,
  } from '@prisma/client';
  
  export const PAYMENT_STATE_MACHINE: Record<
    TransactionStatus,
    TransactionStatus[]
  > = {
  
    [TransactionStatus.PENDING]: [
      TransactionStatus.SUCCESS,
      TransactionStatus.FAILED,
    ],
  
    [TransactionStatus.SUCCESS]: [
      TransactionStatus.REFUNDED,
    ],
  
    [TransactionStatus.FAILED]: [],
  
    [TransactionStatus.REFUNDED]: [],
  
  };