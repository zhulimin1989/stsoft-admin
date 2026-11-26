/**
 * Convert the mainland-China phone formats emitted by our identity providers
 * into the canonical 11-digit form stored by current application code.
 */
export function normalizeMainlandPhone(value: unknown): string | undefined {
  const raw = typeof value === 'string'
    ? value.trim().replace(/[\s-]/g, '')
    : '';
  if (!raw) return undefined;

  const withoutCountryCode = raw.startsWith('+86')
    ? raw.slice(3)
    : raw.startsWith('86') && raw.length === 13
      ? raw.slice(2)
      : raw;
  return /^1[3-9]\d{9}$/.test(withoutCountryCode) ? withoutCountryCode : undefined;
}

/** Return a privacy-safe directory value for any supported mainland format. */
export function maskMainlandPhone(value: unknown): string | null {
  const phone = normalizeMainlandPhone(value);
  return phone ? `${phone.slice(0, 3)}****${phone.slice(7)}` : null;
}

/**
 * Redact mainland phone numbers embedded in names or other display-only text.
 * Country codes, spaces and hyphens are removed from the rendered mask so the
 * original number cannot be reconstructed from formatting.
 */
export function maskMainlandPhonesInText(value: string): string {
  return value.replace(
    /(^|[^\d])(?:(?:\+?86)[\s-]*)?(1[3-9]\d)[\s-]*(\d{4})[\s-]*(\d{4})(?=[^\d]|$)/g,
    (_match, prefix: string, head: string, _middle: string, tail: string) =>
      `${prefix}${head}****${tail}`,
  );
}
