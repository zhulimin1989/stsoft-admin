import {
  canonicalizePaymentCallbackOrigin,
  PAYMENT_CALLBACK_ORIGIN_MAX_COUNT,
  PAYMENT_CALLBACK_ORIGIN_MAX_LENGTH,
} from '@ruidong/shared';
import type { PaymentCallbackMode, ProductPaymentCallbacks } from '@ruidong/shared';

export const MAX_PAYMENT_CALLBACK_ORIGINS = PAYMENT_CALLBACK_ORIGIN_MAX_COUNT;
export const MAX_PAYMENT_CALLBACK_ORIGIN_LENGTH = PAYMENT_CALLBACK_ORIGIN_MAX_LENGTH;

export interface PaymentCallbackPolicyFormValues {
  paymentCallbackMode: PaymentCallbackMode;
  allowedPaymentCallbackOrigins: string[];
}

export function normalizePaymentCallbackOrigin(value: string): string {
  return canonicalizePaymentCallbackOrigin(value);
}

export function normalizePaymentCallbackOrigins(values: string[]): string[] {
  if (values.length > MAX_PAYMENT_CALLBACK_ORIGINS) {
    throw new Error(`最多配置 ${MAX_PAYMENT_CALLBACK_ORIGINS} 个回跳 Origin`);
  }
  return Array.from(new Set(values.map(normalizePaymentCallbackOrigin)));
}

export function paymentCallbackUpdateValue(values: PaymentCallbackPolicyFormValues): string[] | null {
  if (values.paymentCallbackMode === 'GLOBAL_FALLBACK') return null;
  if (values.paymentCallbackMode === 'DENY_ALL') return [];

  const origins = normalizePaymentCallbackOrigins(values.allowedPaymentCallbackOrigins || []);
  if (origins.length === 0) {
    throw new Error('产品白名单模式至少需要配置一个回跳 Origin');
  }
  return origins;
}

export function paymentCallbackFormValues(
  paymentCallbacks: ProductPaymentCallbacks,
): PaymentCallbackPolicyFormValues {
  return {
    paymentCallbackMode: paymentCallbacks.mode,
    allowedPaymentCallbackOrigins: paymentCallbacks.configuredOrigins || [],
  };
}
