import { describe, expect, it } from 'vitest';
import type { ProviderAccountIdentity } from '../../api/admin';
import {
  isProviderAccountIdentityActive,
  providerAccountIdentitiesForProvider,
  providerAccountIdentitySelectionError,
} from '../providerAccountIdentities';

const identities: ProviderAccountIdentity[] = [
  {
    id: 'identity-kimi',
    ref: 'pa_kimi',
    providerCode: 'kimi',
    displayName: 'Kimi 主账户',
    status: 'active',
  },
  {
    id: 'identity-openai',
    ref: 'pa_openai',
    providerCode: 'openai',
    displayName: 'OpenAI 主账户',
    status: 'inactive',
  },
];

describe('provider account identity selection', () => {
  it('only returns identities owned by the selected provider', () => {
    expect(providerAccountIdentitiesForProvider(identities, ' KIMI ')).toEqual([
      identities[0],
    ]);
  });

  it('matches legacy Moonshot providers to the canonical Kimi account', () => {
    expect(providerAccountIdentitiesForProvider(identities, 'moonshot')).toEqual([
      identities[0],
    ]);
  });

  it('only treats the active status as selectable', () => {
    expect(isProviderAccountIdentityActive(identities[0])).toBe(true);
    expect(isProviderAccountIdentityActive(identities[1])).toBe(false);
  });

  it('rejects missing, inactive, and cross-provider selections', () => {
    expect(providerAccountIdentitySelectionError(identities, undefined, 'kimi'))
      .toBe('请选择供应商账户身份');
    expect(providerAccountIdentitySelectionError(identities, 'identity-openai', 'openai'))
      .toContain('已停用');
    expect(providerAccountIdentitySelectionError(identities, 'identity-kimi', 'openai'))
      .toContain('不匹配');
  });
});
