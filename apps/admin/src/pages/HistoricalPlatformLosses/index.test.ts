import { describe, expect, it } from 'vitest';
import { historicalPlatformLossApprovalIssue } from './index';

const preparedBatch = {
  status: 'PREPARED' as const,
  makerActorId: 'maker-1',
};

describe('historicalPlatformLossApprovalIssue', () => {
  it('allows only a different Finance or Super Admin actor with approval permission', () => {
    expect(historicalPlatformLossApprovalIssue(
      preparedBatch,
      { id: 'checker-1', presetRole: 'finance' },
      true,
    )).toBeNull();
    expect(historicalPlatformLossApprovalIssue(
      preparedBatch,
      { id: 'checker-2', presetRole: 'super_admin' },
      true,
    )).toBeNull();
  });

  it('enforces maker-checker separation', () => {
    expect(historicalPlatformLossApprovalIssue(
      preparedBatch,
      { id: 'maker-1', presetRole: 'finance' },
      true,
    )).toBe('Maker-checker：创建人不能审批自己的批次');
  });

  it('does not trust a permission accidentally granted to another preset role', () => {
    expect(historicalPlatformLossApprovalIssue(
      preparedBatch,
      { id: 'checker-1', presetRole: 'admin' },
      true,
    )).toBe('只有 Finance 或 Super Admin 可以审批入账');
  });

  it('requires the explicit approval permission and a prepared batch', () => {
    expect(historicalPlatformLossApprovalIssue(
      preparedBatch,
      { id: 'checker-1', presetRole: 'finance' },
      false,
    )).toBe('缺少 approve_post 权限');
    expect(historicalPlatformLossApprovalIssue(
      { status: 'POSTED', makerActorId: 'maker-1' },
      { id: 'checker-1', presetRole: 'finance' },
      true,
    )).toBe('只有 PREPARED 批次可以审批入账');
  });
});
