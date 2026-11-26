import { describe, expect, it, vi } from 'vitest';
import {
  createSubmitGate,
  describeFundingError,
  generateIdempotencyKey,
  isTimeoutLikeError,
  resolveIdempotencyKey,
  submitWithReplayConfirmation,
  takeIdempotencyKey,
  type PendingIdempotency,
} from '../idempotency';

const ACCOUNT = '6ad5ab22-add8-48d4-87f8-295781d4ca8d';
const OTHER = '3c395adf-e43a-493e-944a-e1aa9fdc4deb';

describe('generateIdempotencyKey', () => {
  it('带上前缀与账户 id，便于在服务端审计里定位来源', () => {
    const key = generateIdempotencyKey('enterprise-recharge', ACCOUNT);
    expect(key.startsWith(`enterprise-recharge:${ACCOUNT}:`)).toBe(true);
  });

  it('两次调用不相同 —— 不同的提交意图必须是不同的键', () => {
    expect(generateIdempotencyKey('p', ACCOUNT)).not.toBe(generateIdempotencyKey('p', ACCOUNT));
  });
});

describe('resolveIdempotencyKey', () => {
  it('首次提交生成新键并交回 pending', () => {
    const { key, pending } = resolveIdempotencyKey(null, 'enterprise-recharge', ACCOUNT);
    expect(pending).toEqual({ accountId: ACCOUNT, key });
  });

  it('★ 同账户重试复用同一个键（本修复的核心：否则超时后重试会重复扣款）', () => {
    const first = resolveIdempotencyKey(null, 'enterprise-recharge', ACCOUNT);
    const retry = resolveIdempotencyKey(first.pending, 'enterprise-recharge', ACCOUNT);
    const retryAgain = resolveIdempotencyKey(retry.pending, 'enterprise-recharge', ACCOUNT);
    expect(retry.key).toBe(first.key);
    expect(retryAgain.key).toBe(first.key);
  });

  it('切换账户时重新生成 —— 键不可跨账户复用', () => {
    const first = resolveIdempotencyKey(null, 'enterprise-recharge', ACCOUNT);
    const other = resolveIdempotencyKey(first.pending, 'enterprise-recharge', OTHER);
    expect(other.key).not.toBe(first.key);
    expect(other.pending.accountId).toBe(OTHER);
  });

  it('成功后清空（pending=null）再提交是新的一笔，键必须不同', () => {
    const first = resolveIdempotencyKey(null, 'enterprise-recharge', ACCOUNT);
    const afterSuccess = resolveIdempotencyKey(null, 'enterprise-recharge', ACCOUNT);
    expect(afterSuccess.key).not.toBe(first.key);
  });

  it('充值与调整用各自的前缀，互不串用', () => {
    const recharge = resolveIdempotencyKey(null, 'enterprise-recharge', ACCOUNT);
    const adjust = resolveIdempotencyKey(null, 'enterprise-billing-adjustment', ACCOUNT);
    expect(recharge.key.startsWith('enterprise-recharge:')).toBe(true);
    expect(adjust.key.startsWith('enterprise-billing-adjustment:')).toBe(true);
  });

  it('不修改传入的 pending 对象（保持 state 更新的可预期性）', () => {
    const pending: PendingIdempotency = { accountId: ACCOUNT, key: 'k1' };
    const snapshot = { ...pending };
    resolveIdempotencyKey(pending, 'enterprise-recharge', OTHER);
    expect(pending).toEqual(snapshot);
  });
});

describe('createSubmitGate', () => {
  it('rejects a second enter until leave, so double-click cannot start two submits', () => {
    const gate = createSubmitGate();
    expect(gate.tryEnter()).toBe(true);
    expect(gate.tryEnter()).toBe(false);
    gate.leave();
    expect(gate.tryEnter()).toBe(true);
  });
});

describe('takeIdempotencyKey', () => {
  it('writes the key back to the ref so an overlapping submit reuses it', () => {
    const box: { current: PendingIdempotency } = { current: null };
    const first = takeIdempotencyKey(box, 'enterprise-voucher', ACCOUNT);
    const second = takeIdempotencyKey(box, 'enterprise-voucher', ACCOUNT);
    expect(second).toBe(first);
    expect(box.current).toEqual({ accountId: ACCOUNT, key: first });
  });
});

describe('describeFundingError', () => {
  it('409 幂等冲突 → 提示先刷新核对，不要继续提交', () => {
    const msg = describeFundingError(
      { response: { status: 409, data: { code: 'enterprise_credit_idempotency_conflict' } } },
      'fallback',
    );
    expect(msg).toContain('上一笔可能已经生效');
    expect(msg).toContain('刷新核对');
  });

  // 注意:这条文案只在 submitWithReplayConfirmation 自动确认耗尽之后才展示,
  // 所以正确建议不再是「重试安全」,而是「别再提交,去人工核对」。
  it('502/504 超时 → 说明可能已生效，并要求人工核对而不是继续提交', () => {
    for (const status of [502, 503, 504]) {
      const msg = describeFundingError({ response: { status } }, 'fallback');
      expect(msg).toContain('可能已经生效');
      expect(msg).toContain('刷新核对余额');
      expect(msg).toContain('不要重复提交');
    }
  });

  it('客户端中断（ECONNABORTED）同样按超时处理', () => {
    const msg = describeFundingError({ code: 'ECONNABORTED' }, 'fallback');
    expect(msg).toContain('可能已经生效');
  });

  it('其他错误优先透出服务端 message', () => {
    const msg = describeFundingError(
      { response: { status: 400, data: { message: '请输入大于 0 的充值金额' } } },
      'fallback',
    );
    expect(msg).toBe('请输入大于 0 的充值金额');
  });

  it('无 response 时退回 error.message，再退回 fallback', () => {
    expect(describeFundingError(new Error('boom'), 'fallback')).toBe('boom');
    expect(describeFundingError({}, 'fallback')).toBe('fallback');
    expect(describeFundingError(null, 'fallback')).toBe('fallback');
  });

  it('409 但不是幂等冲突 → 不套用幂等文案', () => {
    const msg = describeFundingError(
      { response: { status: 409, data: { code: 'billing_account_not_provisioned', message: '账务账号尚未开户' } } },
      'fallback',
    );
    expect(msg).toBe('账务账号尚未开户');
  });
});

describe('isTimeoutLikeError', () => {
  it.each([502, 503, 504])('%i 视为超时类', (status) => {
    expect(isTimeoutLikeError({ response: { status } })).toBe(true);
  });

  it('ECONNABORTED / ETIMEDOUT 视为超时类', () => {
    expect(isTimeoutLikeError({ code: 'ECONNABORTED' })).toBe(true);
    expect(isTimeoutLikeError({ code: 'ETIMEDOUT' })).toBe(true);
  });

  it.each([400, 409, 422, 500])('%i 不是超时类（不可自动重试）', (status) => {
    expect(isTimeoutLikeError({ response: { status } })).toBe(false);
  });
});

describe('submitWithReplayConfirmation', () => {
  const noSleep = () => Promise.resolve();
  const timeout = () => Object.assign(new Error('gateway timeout'), { response: { status: 502 } });

  it('首次成功 → 只提交一次', async () => {
    const submit = vi.fn().mockResolvedValue('ok');
    await expect(submitWithReplayConfirmation(submit, { sleep: noSleep })).resolves.toBe('ok');
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('★ 首次超时、第二次命中回放 → 对操作者呈现为成功', async () => {
    const submit = vi.fn()
      .mockRejectedValueOnce(timeout())
      .mockResolvedValue({ replayed: true });
    await expect(submitWithReplayConfirmation(submit, { sleep: noSleep }))
      .resolves.toEqual({ replayed: true });
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it('★ 非超时错误立即抛出，绝不重试（409 幂等冲突尤其不能重提）', async () => {
    const conflict = Object.assign(new Error('conflict'), {
      response: { status: 409, data: { code: 'enterprise_credit_idempotency_conflict' } },
    });
    const submit = vi.fn().mockRejectedValue(conflict);
    await expect(submitWithReplayConfirmation(submit, { sleep: noSleep })).rejects.toBe(conflict);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('全部尝试都超时 → 抛出最后一次错误，次数等于 attempts', async () => {
    const submit = vi.fn().mockRejectedValue(timeout());
    await expect(submitWithReplayConfirmation(submit, { attempts: 3, sleep: noSleep }))
      .rejects.toMatchObject({ response: { status: 502 } });
    expect(submit).toHaveBeenCalledTimes(3);
  });

  it('确认进度回调在每次重试前触发，最后一次尝试后不再回调', async () => {
    const onConfirming = vi.fn();
    const submit = vi.fn().mockRejectedValue(timeout());
    await expect(submitWithReplayConfirmation(submit, {
      attempts: 3, sleep: noSleep, onConfirming,
    })).rejects.toBeDefined();
    expect(onConfirming.mock.calls).toEqual([[1, 3], [2, 3]]);
  });

  it('按给定间隔等待（注入 sleep 便于断言，不真的挂时钟）', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const submit = vi.fn().mockRejectedValueOnce(timeout()).mockResolvedValue('ok');
    await submitWithReplayConfirmation(submit, { delayMs: 1234, sleep });
    expect(sleep).toHaveBeenCalledWith(1234);
  });
});

describe('describeFundingError — 超时文案', () => {
  it('★ 必须明确「不要关闭弹窗」——关闭会清空幂等键，重开再提交就是第二笔', () => {
    const msg = describeFundingError({ response: { status: 502 } }, 'fallback');
    expect(msg).toContain('请勿关闭本弹窗');
    expect(msg).toContain('不要重复提交');
  });
});
