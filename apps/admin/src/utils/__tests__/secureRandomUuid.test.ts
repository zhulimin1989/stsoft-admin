import { expect, it, vi } from 'vitest';
import { secureRandomUuid } from '../secureRandomUuid';

const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

it('prefers the native UUID implementation when it is available', () => {
  const expected = '11111111-2222-4333-8444-555555555555';
  const source = {
    randomUUID: vi.fn(() => expected),
    getRandomValues: vi.fn(),
  } as unknown as Crypto;

  expect(secureRandomUuid(source)).toBe(expected);
  expect(source.randomUUID).toHaveBeenCalledTimes(1);
  expect(source.getRandomValues).not.toHaveBeenCalled();
});

it('falls back to secure random bytes and sets UUID version and variant bits', () => {
  let seed = 0;
  const source = {
    getRandomValues: (bytes: Uint8Array) => {
      bytes.forEach((_, index) => { bytes[index] = (seed + index) & 0xff; });
      seed += 17;
      return bytes;
    },
  } as unknown as Crypto;

  const first = secureRandomUuid(source);
  const second = secureRandomUuid(source);
  expect(first).toMatch(uuidV4);
  expect(second).toMatch(uuidV4);
  expect(second).not.toBe(first);
});

it('fails closed when no secure random source exists', () => {
  expect(() => secureRandomUuid(null)).toThrow('Secure random UUID source is unavailable');
  expect(() => secureRandomUuid({} as Crypto)).toThrow('Secure random UUID source is unavailable');
});
