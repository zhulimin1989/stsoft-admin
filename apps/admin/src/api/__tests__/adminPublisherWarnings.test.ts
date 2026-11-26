import { describe, expect, it } from 'vitest';
import { publisherWarningsText } from '../admin';

describe('publisherWarningsText', () => {
  it('formats shared credential warnings without exposing raw JSON', () => {
    const text = publisherWarningsText([
      {
        code: 'shared_credential_group',
        message:
          'credential identity is used by multiple channelized providers; aggregate key limit is not enforced by provider-level runtime policies',
        providers: [
          'pc_6e5e9d65-1b5a-4ae2-8d17-7002114ae79d',
          'pc_bd5b5181-057e-4361-9b2e-b4291b1317cc',
        ],
        credential: 'shared_credential:e73d67f35141',
        meta: {
          aggregate_limit_unenforced: 'true',
          shared_credential_group: 'shared_credential:e73d67f35141',
        },
      },
    ]);

    expect(text).toBe(
      '共享凭证被 2 个上游 Provider 复用，Publisher 无法按单个 Provider 强制聚合 Key 限额；请确认共用凭证符合预期',
    );
    expect(text).not.toContain('{');
    expect(text).not.toContain('pc_6e5e9d65');
    expect(text).not.toContain('shared_credential:e73d67f35141');
  });

  it('uses message text for generic object warnings', () => {
    expect(publisherWarningsText([{ code: 'publisher_warning', message: 'publish skipped' }])).toBe(
      'publisher_warning: publish skipped',
    );
  });

  it('keeps the warning count suffix', () => {
    expect(publisherWarningsText(['first', 'second', 'third'], 2)).toBe('first；second；另有 1 条');
  });
});
