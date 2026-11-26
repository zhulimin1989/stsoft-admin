type SecureUuidCrypto = Pick<Crypto, 'getRandomValues'> & Partial<Pick<Crypto, 'randomUUID'>>;

export function secureRandomUuid(source: SecureUuidCrypto | null | undefined = globalThis.crypto): string {
  if (source && typeof source.randomUUID === 'function') {
    try {
      return source.randomUUID.call(source);
    } catch {
      // Some browsers expose randomUUID but reject it outside a secure context.
    }
  }

  if (!source || typeof source.getRandomValues !== 'function') {
    throw new Error('Secure random UUID source is unavailable');
  }

  const bytes = new Uint8Array(16);
  source.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}
