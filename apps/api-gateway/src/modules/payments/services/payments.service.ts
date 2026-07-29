import {
  BadRequestException,
  Injectable,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

import {
  TransactionStatus,
  PaymentStatus,
  PaymentProvider as ProviderType,
  PaymentMethod,
  type Payment,
} from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

import { PaymentsRepository } from '../repositories/payments.repository';

import { RazorpayProvider } from '../providers/razorpay.provider';

import { EventBusService } from '../../../core/events/event-bus.service';

import { QueueService } from '../../../infrastructure/queues/queue.service';
import { AppLoggerService } from '../../../infrastructure/logger/logger.service';
import { PAYMENT_EVENTS } from '../events/payment-events.constants';
import { PaymentStatusValidator } from '../Validators/payment-status.validator';
import { getAllowedSourceStatuses } from '../constants/payment-state-machine';
import { GetAdminPaymentsQueryDto } from '../dto/get-admin-payments-query.dto';
import { PaginatedAdminPaymentsResponseDto } from '../dto/paginated-admin-payments-response.dto';
import { AdminPaymentResponseDto } from '../dto/admin-payment-response.dto';

/** Amounts within a paisa of each other are treated as equal — avoids float-rounding false negatives. */
const AMOUNT_TOLERANCE = 0.01;

/** Razorpay's captured-payment webhook entity uses lowercase method names — map onto our enum. */
const RAZORPAY_METHOD_MAP: Record<string, string> = {
  upi: 'UPI',
  card: 'CARD',
  netbanking: 'NETBANKING',
  wallet: 'WALLET',
};

/** The subset of Razorpay's payment entity this service actually reads — both from a webhook
 *  delivery and from a direct `payments.fetch()` call (see RazorpayProvider.fetchPayment). */
interface RazorpayPaymentEntity {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  status?: string;
  method?: string;
}

/**
 * Flattens the raw Prisma include shape (order.customer as a full User row) into the documented
 * AdminPaymentResponseDto shape — this is what keeps the customer's passwordHash out of admin
 * API responses.
 */
function toAdminPayment(payment: any): AdminPaymentResponseDto {
  return {
    id: payment.id,
    orderId: payment.orderId,
    order: {
      id: payment.order.id,
      orderNumber: payment.order.orderNumber,
      status: payment.order.status,
    },
    customer: {
      id: payment.order.customer.id,
      firstName: payment.order.customer.firstName,
      lastName: payment.order.customer.lastName,
      email: payment.order.customer.email,
      phone: payment.order.customer.phone,
    },
    amount: Number(payment.amount),
    provider: payment.provider,
    method: payment.method ?? undefined,
    status: payment.status,
    providerOrderId: payment.providerOrderId ?? undefined,
    providerPaymentId: payment.providerPaymentId ?? undefined,
    refunds: payment.refunds.map((refund: any) => ({
      id: refund.id,
      amount: Number(refund.amount),
      reason: refund.reason ?? undefined,
      status: refund.status,
      createdAt: refund.createdAt,
    })),
    attemptNumber: payment.attemptNumber,
    isActive: payment.isActive,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  };
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly paymentsRepository: PaymentsRepository,

    private readonly razorpayProvider: RazorpayProvider,

    private readonly eventBus: EventBusService,

    private readonly queueService: QueueService,

    private readonly prisma: PrismaService,

    private readonly logger: AppLoggerService,
  ) {}

  async createPayment(orderId: string, amount: number, userId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        customerId: true,
        paymentStatus: true,
        totalAmount: true,
        walletAmountUsed: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (order.customerId !== userId) {
      throw new ForbiddenException('You do not have access to this order');
    }

    if (order.paymentStatus === PaymentStatus.PAID) {
      throw new ConflictException('Order already paid');
    }

    // The order may already be partially paid via wallet (C9 mixed payment) — the Razorpay leg
    // must cover exactly what's left, never an amount the client made up.
    const expectedAmount =
      Number(order.totalAmount) - Number(order.walletAmountUsed);

    if (Math.abs(amount - expectedAmount) > AMOUNT_TOLERANCE) {
      throw new BadRequestException(
        `Payment amount must equal the order's remaining payable amount (${expectedAmount.toFixed(2)})`,
      );
    }

    const activePayment =
      await this.paymentsRepository.findActivePaymentForOrder(orderId);

    if (activePayment && activePayment.status === TransactionStatus.SUCCESS) {
      throw new ConflictException('Order already paid');
    }

    const latestAttempt =
      await this.paymentsRepository.findLatestAttempt(orderId);

    const attemptNumber = latestAttempt ? latestAttempt.attemptNumber + 1 : 1;

    await this.paymentsRepository.deactivateOrderAttempts(orderId);

    // Razorpay rejects receipts over 40 characters — a full UUID orderId plus prefix/suffix
    // already exceeds that, so this keeps just enough of the order id to stay unique in practice.
    const receipt = `ord_${orderId.slice(0, 28)}_${attemptNumber}`;

    const providerOrder = await this.razorpayProvider.createOrder(
      amount,
      receipt,
    );

    const payment = await this.paymentsRepository.createPayment({
      orderId,

      provider: ProviderType.RAZORPAY,

      amount,

      providerOrderId: providerOrder.id,

      attemptNumber,

      isActive: true,
    });

    this.logger.log(
      {
        event: 'payment_initiated',
        paymentId: payment.id,
        orderId,
        amount,
        attemptNumber,
      },
      'PaymentsService',
    );

    return {
      payment,

      providerOrder,
    };
  }

  /**
   * The client-driven verification path (called right after the Razorpay checkout widget's
   * success handler — see frontend `PaymentsCheckoutService.payForOrder`). `userId` is the
   * authenticated caller's id (Sprint 1.5 — this endpoint previously had no auth guard at all,
   * so anything binding the request to the right customer had to be added here); every other
   * check below was already present or is new in the same sprint, noted inline.
   */
  async verifyPayment(payload: any, userId: string) {
    const isValid = await this.razorpayProvider.verifySignature(payload);

    if (!isValid) {
      this.logger.error(
        {
          event: 'payment_signature_verification_failed',
          providerOrderId: payload?.razorpay_order_id,
        },
        undefined,
        'PaymentsService',
      );

      throw new ConflictException('Invalid payment signature');
    }

    const payment =
      await this.paymentsRepository.findByProviderOrderIdWithOwner(
        payload.razorpay_order_id,
      );

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    // Ownership check (Sprint 1.5) — the signature alone only proves the request came from
    // someone who saw a genuine Razorpay callback for this order; it says nothing about who's
    // presenting it. Without this, any authenticated customer could replay another customer's
    // (observed/leaked) verify payload and have it processed against someone else's order.
    if (payment.order.customerId !== userId) {
      this.logger.error(
        {
          event: 'payment_verify_ownership_mismatch',
          paymentId: payment.id,
          orderId: payment.orderId,
          userId,
        },
        undefined,
        'PaymentsService',
      );

      throw new ForbiddenException('You do not have access to this payment');
    }

    if (payment.status === TransactionStatus.SUCCESS) {
      // Already processed — a duplicate verify call (double-click, browser retry, or a race
      // with the webhook) is a no-op, not an error.
      return payment;
    }

    // Amount/currency/capture confirmation (Sprint 1.5) — the HMAC ties order_id to payment_id,
    // but never on its own confirms what Razorpay actually captured. Asking Razorpay directly
    // for the authoritative amount/currency/status closes that gap before any money is treated
    // as received.
    await this.assertProviderPaymentMatches(
      payment,
      payload.razorpay_payment_id,
    );

    await this.paymentsRepository.deactivateOrderAttempts(payment.orderId);

    const { payment: updatedPayment, transitioned } =
      await this.transitionPaymentStatus(
        payment.id,

        TransactionStatus.SUCCESS,

        payload.razorpay_payment_id,
      );

    if (transitioned) {
      await this.eventBus.publish(
        'payment.success',

        {
          paymentId: payment.id,

          orderId: payment.orderId,
        },
      );

      await this.enqueuePaymentSuccessNotification(payment.orderId);

      this.logger.log(
        {
          event: 'payment_verified_client_side',
          paymentId: payment.id,
          orderId: payment.orderId,
        },
        'PaymentsService',
      );
    }

    return updatedPayment;
  }

  /** Fetches the payment directly from Razorpay and confirms it was actually captured, for the
   *  expected amount, in the expected currency — see verifyPayment's doc comment. */
  private async assertProviderPaymentMatches(
    payment: { id: string; orderId: string; amount: any },
    providerPaymentId: string,
  ): Promise<void> {
    const providerPayment = (await this.razorpayProvider.fetchPayment(
      providerPaymentId,
    )) as Partial<RazorpayPaymentEntity>;
    const expectedAmountPaise = Math.round(Number(payment.amount) * 100);

    const matches =
      providerPayment?.amount === expectedAmountPaise &&
      providerPayment?.currency === 'INR' &&
      providerPayment?.status === 'captured';

    if (!matches) {
      this.logger.error(
        {
          event: 'payment_amount_mismatch',
          paymentId: payment.id,
          orderId: payment.orderId,
          expectedAmountPaise,
          actualAmount: providerPayment?.amount,
          actualCurrency: providerPayment?.currency,
          actualStatus: providerPayment?.status,
        },
        undefined,
        'PaymentsService',
      );

      throw new ConflictException(
        'Payment amount, currency, or status does not match the expected order',
      );
    }
  }

  /** Best-effort — Redis/BullMQ being unavailable must never fail payment verification itself;
   *  the DB write (Payment.status, the source of truth) has already committed by the time this
   *  runs. Same fail-open posture as other best-effort steps elsewhere in this codebase (e.g.
   *  AuthService.logout's best-effort server-side revoke). */
  private async enqueuePaymentSuccessNotification(
    orderId: string,
  ): Promise<void> {
    try {
      await this.queueService.addNotificationJob({
        type: 'payment-success',
        orderId,
      });
    } catch (error) {
      this.logger.error(
        {
          event: 'payment_notification_enqueue_failed',
          orderId,
          reason: error instanceof Error ? error.message : 'Unknown error',
        },
        error instanceof Error ? error.stack : undefined,
        'PaymentsService',
      );
    }
  }
  private async handlePaymentCaptured(payload: any) {
    const entity = payload.payload.payment.entity as RazorpayPaymentEntity;

    const payment = await this.paymentsRepository.findByProviderOrderId(
      entity.order_id,
    );

    if (!payment) {
      return;
    }

    if (payment.status === TransactionStatus.SUCCESS) {
      // Already processed — a duplicate webhook delivery (Razorpay retries undelivered/
      // unacknowledged webhooks) or a race with the client-driven verify call is a no-op.
      return;
    }

    // Amount/currency confirmation (Sprint 1.5) — the webhook's own payload already carries
    // Razorpay's authoritative captured amount/currency, so unlike verifyPayment this needs no
    // extra API call; it's the same check applied to the other entry point into SUCCESS.
    const expectedAmountPaise = Math.round(Number(payment.amount) * 100);

    if (entity.amount !== expectedAmountPaise || entity.currency !== 'INR') {
      this.logger.error(
        {
          event: 'payment_webhook_amount_mismatch',
          paymentId: payment.id,
          orderId: payment.orderId,
          expectedAmountPaise,
          actualAmount: entity.amount,
          actualCurrency: entity.currency,
        },
        undefined,
        'PaymentsService',
      );

      // Deliberately does not transition the payment and does not throw — throwing here would
      // make processWebhook() 500 and cause Razorpay to endlessly retry an event that will
      // never match. The webhook is still acknowledged (processWebhook's own return), and the
      // mismatch is logged loudly for manual reconciliation.
      return;
    }

    const { payment: updatedPayment, transitioned } =
      await this.transitionPaymentStatus(
        payment.id,

        TransactionStatus.SUCCESS,

        entity.id,

        entity.method
          ? (RAZORPAY_METHOD_MAP[entity.method] as PaymentMethod | undefined)
          : undefined,
      );

    if (transitioned) {
      await this.eventBus.publish(
        'payment.success',

        {
          paymentId: payment.id,

          orderId: payment.orderId,
        },
      );

      await this.enqueuePaymentSuccessNotification(payment.orderId);

      this.logger.log(
        {
          event: 'payment_captured_webhook',
          paymentId: payment.id,
          orderId: payment.orderId,
        },
        'PaymentsService',
      );
    }

    return updatedPayment;
  }

  /**
   * Marks a payment successful from outside the verify/webhook flow — used by
   * PaymentReconciliationService when it finds a captured Razorpay payment whose webhook never
   * arrived. Reuses the same transition + event-publish + notification path as
   * handlePaymentCaptured so the order reaches PAID via the existing `payment.success` listener
   * (OrderPaymentListener) instead of a second, parallel status-transition path.
   */
  async markPaymentSucceededFromReconciliation(
    paymentId: string,
    providerPaymentId: string,
  ) {
    const payment = await this.paymentsRepository.findById(paymentId);

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    if (payment.status === TransactionStatus.SUCCESS) {
      return payment;
    }

    const { payment: updatedPayment, transitioned } =
      await this.transitionPaymentStatus(
        payment.id,

        TransactionStatus.SUCCESS,

        providerPaymentId,
      );

    if (transitioned) {
      await this.eventBus.publish(
        'payment.success',

        {
          paymentId: payment.id,

          orderId: payment.orderId,
        },
      );

      await this.enqueuePaymentSuccessNotification(payment.orderId);
    }

    return updatedPayment;
  }

  private async handlePaymentFailed(payload: any) {
    const entity = payload.payload.payment.entity as RazorpayPaymentEntity;

    const payment = await this.paymentsRepository.findByProviderOrderId(
      entity.order_id,
    );

    if (!payment) {
      return;
    }

    if (payment.status === TransactionStatus.FAILED) {
      return;
    }

    const { transitioned } = await this.transitionPaymentStatus(
      payment.id,

      TransactionStatus.FAILED,

      entity.id,
    );

    if (transitioned) {
      await this.eventBus.publish(
        'payment.failed',

        {
          paymentId: payment.id,

          orderId: payment.orderId,
        },
      );

      this.logger.error(
        {
          event: 'payment_failed_webhook',
          paymentId: payment.id,
          orderId: payment.orderId,
        },
        undefined,
        'PaymentsService',
      );
    }
  }
  /**
   * The single choke point every payment status write goes through (verifyPayment,
   * handlePaymentCaptured, handlePaymentFailed, markPaymentSucceededFromReconciliation,
   * refundPayment). Sprint 1.5 — this used to be read-status / validate-in-memory / write-status
   * as three separate calls, a classic check-then-act race: the client's verify call and
   * Razorpay's webhook (or two overlapping deliveries of either) both reading PENDING before
   * either had written SUCCESS could both proceed to write. Replaced with an atomic conditional
   * UPDATE (PaymentsRepository.claimStatusTransition) — see its doc comment and
   * payment-state-machine.ts's getAllowedSourceStatuses for the full reasoning.
   *
   * Returns `transitioned: true` only when THIS call was the one that actually moved the row —
   * never when it merely confirmed a transition some other, concurrent caller already made.
   * That distinction is what every call site below uses to decide whether to fire the
   * once-only downstream effects (event publish, notification) — the atomic claim alone stops
   * the *row* from being written twice, but every one of N concurrent callers would otherwise
   * still reach the "success" code path and each fire its own event/notification, since none of
   * them throws. `transitioned: false` is not an error case; it's the correct, expected outcome
   * for every loser of the race (or a plain replay of an already-applied transition).
   */
  private async transitionPaymentStatus(
    paymentId: string,

    nextStatus: TransactionStatus,

    providerPaymentId?: string,

    method?: PaymentMethod,
  ): Promise<{ payment: Payment; transitioned: boolean }> {
    const payment = await this.paymentsRepository.findById(paymentId);

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    if (payment.status === nextStatus) {
      // Already there — idempotent no-op, not an error, and not this call's transition.
      return { payment, transitioned: false };
    }

    // Fast-fail for a target status this payment could never legally reach from its
    // last-observed status — cheap, and gives a clean error message without touching the DB
    // again. This read can be stale by the time the atomic claim below runs; that's fine, since
    // the claim's own WHERE clause (not this check) is what actually enforces the transition
    // against a concurrent writer.
    PaymentStatusValidator.validateTransition(
      payment.status,

      nextStatus,
    );

    const claim = await this.paymentsRepository.claimStatusTransition(
      paymentId,

      getAllowedSourceStatuses(nextStatus),

      nextStatus,

      providerPaymentId,

      method,
    );

    if (claim.count === 0) {
      // Lost the race to a concurrent transition, or the transition was never valid — re-read
      // to tell the two apart. The row can't have vanished between the reads above and here
      // (Payment rows are never deleted independently of their Order), so a non-null assertion
      // is safe.
      const current = (await this.paymentsRepository.findById(paymentId))!;

      if (current.status === nextStatus) {
        return { payment: current, transitioned: false };
      }

      throw new ConflictException(
        `Invalid payment status transition: ${current.status} -> ${nextStatus}`,
      );
    }

    const updated = (await this.paymentsRepository.findById(paymentId))!;

    return { payment: updated, transitioned: true };
  }

  async refundPayment(paymentId: string, amount: number, reason?: string) {
    const payment = await this.paymentsRepository.findById(paymentId);

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    if (payment.status !== TransactionStatus.SUCCESS) {
      throw new ConflictException('Only successful payments can be refunded');
    }

    const refund = await this.razorpayProvider.refund(
      payment.providerPaymentId!,
      amount,
    );
    await this.transitionPaymentStatus(
      payment.id,

      TransactionStatus.REFUNDED,
    );

    await this.paymentsRepository.createRefund({
      paymentId,

      amount,

      reason,

      status: TransactionStatus.REFUNDED,
    });

    this.logger.log(
      {
        event: 'payment_refunded',
        paymentId,
        orderId: payment.orderId,
        amount,
      },
      'PaymentsService',
    );

    return refund;
  }

  async processWebhook(payload: any, rawBody: string, signature: string) {
    const isValid = this.razorpayProvider.verifyWebhookSignature(
      rawBody,
      signature,
    );

    if (!isValid) {
      // No trace previously existed of a forged/invalid webhook attempt — a real fraud/security
      // signal that was silently discarded (production-validation audit finding).
      this.logger.error(
        { event: 'payment_webhook_signature_invalid' },
        undefined,
        'PaymentsService',
      );

      throw new UnauthorizedException('Invalid webhook signature');
    }

    switch (payload.event) {
      case PAYMENT_EVENTS.CAPTURED:
        await this.handlePaymentCaptured(payload);

        break;

      case PAYMENT_EVENTS.FAILED:
        await this.handlePaymentFailed(payload);

        break;
    }

    await this.paymentsRepository.createWebhookEvent({
      provider: 'RAZORPAY',

      eventType: payload.event,

      payload,

      processed: true,
    });

    return {
      success: true,
    };
  }

  async getGrossRevenueToday(): Promise<number> {
    return this.paymentsRepository.sumSuccessfulAmountToday();
  }

  async findActivePaymentForOrder(orderId: string) {
    return this.paymentsRepository.findActivePaymentForOrder(orderId);
  }

  async getAllForAdmin(
    query: GetAdminPaymentsQueryDto,
  ): Promise<PaginatedAdminPaymentsResponseDto> {
    const skip = (query.page - 1) * query.limit;

    const { items, total } = await this.paymentsRepository.findAllForAdmin({
      search: query.search,
      status: query.status,
      provider: query.provider,
      method: query.method,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      skip,
      take: query.limit,
    });

    return {
      items: items.map(toAdminPayment),

      total,

      page: query.page,

      limit: query.limit,

      totalPages: Math.ceil(total / query.limit),
    };
  }
}
