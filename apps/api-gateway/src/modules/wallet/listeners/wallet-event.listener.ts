import { Injectable, OnModuleInit } from '@nestjs/common';

import { EventBusService } from '../../../core/events/event-bus.service';

import { WalletService } from '../services/wallet.service';

interface OrderStatusChangedPayload {
  orderId: string;
  customerId: string;
  status: string;
  totalAmount?: number;
}

interface OrderRefundedPayload {
  orderId: string;
  customerId: string;
  walletAmount: number;
}

/**
 * Fully decoupled from OrdersModule/PaymentsModule — reacts to events they already publish
 * (order.status.changed, order.refunded) rather than either module depending on WalletModule
 * directly. This is the "everything event-driven" integration the C9 spec calls for.
 */
@Injectable()
export class WalletEventListener implements OnModuleInit {
  constructor(
    private readonly eventBus: EventBusService,
    private readonly walletService: WalletService,
  ) {}

  onModuleInit() {
    this.eventBus.subscribe(
      'order.status.changed',
      async (event: OrderStatusChangedPayload) => {
        if (event.status !== 'DELIVERED') {
          return;
        }

        if (event.totalAmount !== undefined) {
          await this.walletService.creditCashback(
            event.customerId,
            event.orderId,
            event.totalAmount,
          );
        }

        await this.walletService.rewardReferralIfEligible(event.customerId);
      },
    );

    this.eventBus.subscribe(
      'order.refunded',
      async (event: OrderRefundedPayload) => {
        await this.walletService.creditRefund(
          event.customerId,
          event.orderId,
          event.walletAmount,
        );
      },
    );
  }
}
