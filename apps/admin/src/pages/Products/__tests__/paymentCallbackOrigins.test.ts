import { describe, expect, it } from 'vitest';
import { createProductSchema, updateProductSchema } from '@ruidong/shared';
import {
  normalizePaymentCallbackOrigin,
  normalizePaymentCallbackOrigins,
  paymentCallbackUpdateValue,
} from '../paymentCallbackOrigins';

describe('payment callback origin policy', () => {
  it('normalizes valid HTTPS and loopback development origins', () => {
    expect(normalizePaymentCallbackOrigin(' HTTPS://APP.EXAMPLE.COM:443/ ')).toBe('https://app.example.com');
    expect(normalizePaymentCallbackOrigin('https://app.example.com:8443')).toBe('https://app.example.com:8443');
    expect(normalizePaymentCallbackOrigin('http://localhost:3010/')).toBe('http://localhost:3010');
    expect(normalizePaymentCallbackOrigin('http://127.0.0.1:3010')).toBe('http://127.0.0.1:3010');
    expect(normalizePaymentCallbackOrigin('http://[::1]:3010')).toBe('http://[::1]:3010');
  });

  it.each([
    'ftp://app.example.com',
    'http://app.example.com',
    'https://app.example.com/payment/success',
    'https://app.example.com/.',
    'https://app.example.com\\payment',
    'https:app.example.com/payment',
    'https:/app.example.com/payment',
    'https:\\app.example.com',
    'https://@app.example.com',
    'https://%2a.app.example.com',
    'https://app\t.example.com',
    'https://app.example.com?source=billing',
    'https://app.example.com?',
    'https://app.example.com#payment',
    'https://app.example.com#',
    'https://user:secret@app.example.com',
    'https://*.example.com',
    'not-a-url',
  ])('rejects unsafe or non-origin value %s', (value) => {
    expect(() => normalizePaymentCallbackOrigin(value)).toThrow();
  });

  it('deduplicates normalized values and enforces the 50-origin limit', () => {
    expect(normalizePaymentCallbackOrigins([
      `${' '.repeat(600)}https://app.example.com${' '.repeat(10)}`,
      'https://APP.example.com/',
      'https://admin.example.com',
    ])).toEqual(['https://app.example.com', 'https://admin.example.com']);

    const tooMany = Array.from({ length: 51 }, (_, index) => `https://app-${index}.example.com`);
    expect(() => normalizePaymentCallbackOrigins(tooMany)).toThrow('最多配置 50 个');
  });

  it('maps the three policy modes to the update contract', () => {
    expect(paymentCallbackUpdateValue({
      paymentCallbackMode: 'GLOBAL_FALLBACK',
      allowedPaymentCallbackOrigins: ['https://ignored.example.com'],
    })).toBeNull();
    expect(paymentCallbackUpdateValue({
      paymentCallbackMode: 'DENY_ALL',
      allowedPaymentCallbackOrigins: ['https://ignored.example.com'],
    })).toEqual([]);
    expect(paymentCallbackUpdateValue({
      paymentCallbackMode: 'PRODUCT_ALLOWLIST',
      allowedPaymentCallbackOrigins: ['https://app.example.com/'],
    })).toEqual(['https://app.example.com']);
    expect(() => paymentCallbackUpdateValue({
      paymentCallbackMode: 'PRODUCT_ALLOWLIST',
      allowedPaymentCallbackOrigins: [],
    })).toThrow('至少需要配置一个');
  });

  it('exposes the field through the shared create and update schemas', () => {
    expect(createProductSchema.safeParse({
      name: 'Example Product',
      slug: 'example-product',
      allowedPaymentCallbackOrigins: ['https://app.example.com'],
    }).success).toBe(true);
    expect(updateProductSchema.safeParse({ allowedPaymentCallbackOrigins: null }).success).toBe(true);
    expect(updateProductSchema.safeParse({ allowedPaymentCallbackOrigins: [] }).success).toBe(true);
    expect(updateProductSchema.safeParse({
      allowedPaymentCallbackOrigins: ['https://app.example.com/payment/success'],
    }).success).toBe(false);
  });
});
