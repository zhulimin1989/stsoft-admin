import type { ProviderAccountIdentity } from '../api/admin';

export function normalizeProviderCode(value: string | null | undefined): string {
  const normalized = (value ?? '').trim().toLowerCase();
  return normalized === 'moonshot' ? 'kimi' : normalized;
}

export function isProviderAccountIdentityActive(identity: ProviderAccountIdentity): boolean {
  return identity.status === 'active';
}

export function providerAccountIdentitiesForProvider(
  identities: ProviderAccountIdentity[],
  provider: string | null | undefined,
): ProviderAccountIdentity[] {
  const normalizedProvider = normalizeProviderCode(provider);
  if (!normalizedProvider) return [];
  return identities.filter(
    (identity) => normalizeProviderCode(identity.providerCode) === normalizedProvider,
  );
}

export function providerAccountIdentitySelectionError(
  identities: ProviderAccountIdentity[],
  identityId: unknown,
  provider: string | null | undefined,
): string | null {
  if (typeof identityId !== 'string' || !identityId.trim()) {
    return '请选择供应商账户身份';
  }
  const identity = identities.find((item) => item.id === identityId);
  if (!identity) {
    return '所选供应商账户身份不存在，请刷新后重试';
  }
  if (!isProviderAccountIdentityActive(identity)) {
    return '所选供应商账户身份已停用，请选择有效账户';
  }
  if (normalizeProviderCode(identity.providerCode) !== normalizeProviderCode(provider)) {
    return '账户身份与当前上游供应商不匹配';
  }
  return null;
}
