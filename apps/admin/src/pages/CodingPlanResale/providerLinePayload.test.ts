import { describe, expect, it } from 'vitest';
import { providerLinePayload } from './index';

const baseValues: Parameters<typeof providerLinePayload>[0] = {
  code: 'zhipu-main',
  name: '智谱主线路',
  providerCode: 'zhipu',
  providerAccountIdentityId: 'identity-zhipu-main',
  adapterType: 'zhipu_partner',
  apiBaseUrl: 'https://open.bigmodel.cn',
};

describe('providerLinePayload', () => {
  it('submits the authoritative provider account identity with the line configuration', () => {
    expect(providerLinePayload(baseValues)).toMatchObject({
      providerCode: 'zhipu',
      providerAccountIdentityId: 'identity-zhipu-main',
    });
  });

  it('normalizes the identity id and rejects a missing association', () => {
    expect(providerLinePayload({
      ...baseValues,
      providerAccountIdentityId: '  identity-zhipu-main  ',
    })).toMatchObject({
      providerAccountIdentityId: 'identity-zhipu-main',
    });
    expect(() => providerLinePayload({
      ...baseValues,
      providerAccountIdentityId: '   ',
    })).toThrow('请选择供应商账户身份');
  });
});
