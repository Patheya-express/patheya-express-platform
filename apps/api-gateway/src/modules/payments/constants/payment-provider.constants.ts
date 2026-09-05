/**
 * NestJS DI token for the active PaymentProvider implementation (see
 * providers/payment-provider.interface.ts). A plain string token, matching this codebase's
 * existing multi-provider convention — see STORAGE_PROVIDER in
 * modules/storage/constants/storage.constants.ts, which the same `{ provide, useExisting }` /
 * `{ provide, useFactory }` pattern is modeled on.
 */
export const PAYMENT_PROVIDER = 'PAYMENT_PROVIDER';
