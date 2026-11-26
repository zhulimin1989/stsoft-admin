/**
 * 企业账户资金操作（充值 / 余额调整）的幂等键管理。
 *
 * 为什么键不能在每次提交时重新生成:billing 侧的资金事务预算是 60 秒
 * (BALANCE_LEDGER_TRANSACTION_OPTIONS.timeout),而 admin-api 的上游超时是 10 秒。
 * Fastify 的超时是 cooperative 的 —— 连接被关闭之后 handler 和 Prisma 事务仍在继续,
 * 若在 60 秒内跑完就会 COMMIT,只是响应送不回来。于是操作者看到 502、以为失败,
 * 再点一次:如果这次带的是新键,服务端的幂等回放不会命中,第二笔就真的入账了。
 *
 * 所以键的生命周期必须绑定「一次提交意图」而不是「一次 HTTP 请求」:
 *   - 同一账户的重试复用同一个键 ⇒ 服务端识别为回放,不会重复扣款
 *   - 提交成功后清空 ⇒ 下一笔是新的意图
 *   - 关闭弹窗后清空 ⇒ 操作者确实想再做一笔同额操作时不会被误判成回放
 *   - 切换账户时重新生成 ⇒ 键里带账户 id,不能跨账户复用
 *
 * 注意:同一个键配不同参数,服务端会返回 409(assertCreditIdempotencyMatch)。
 * 这是**期望行为** —— 上一笔可能已经生效,此时换金额重试属于不安全操作,
 * 必须先刷新核对。UI 文案见 describeFundingError。
 */

export type PendingIdempotency = { accountId: string; key: string } | null;

export function generateIdempotencyKey(prefix: string, accountId: string): string {
  const random = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${accountId}:${random}`;
}

/**
 * 取得本次提交应当使用的幂等键。已有且账户一致则复用，否则新建。
 * 返回的 pending 需由调用方写回 state，使后续重试能复用。
 */
export function resolveIdempotencyKey(
  pending: PendingIdempotency,
  prefix: string,
  accountId: string,
): { key: string; pending: NonNullable<PendingIdempotency> } {
  if (pending && pending.accountId === accountId) {
    return { key: pending.key, pending };
  }
  const key = generateIdempotencyKey(prefix, accountId);
  return { key, pending: { accountId, key } };
}

/** 同步互斥：挡住连点在 React state / confirmLoading 刷新前的第二下。 */
export function createSubmitGate() {
  let locked = false;
  return {
    tryEnter(): boolean {
      if (locked) return false;
      locked = true;
      return true;
    },
    leave() {
      locked = false;
    },
  };
}

/** 从 ref 取键并立刻写回，避免两次提交都读到过期的 state。 */
export function takeIdempotencyKey(
  box: { current: PendingIdempotency },
  prefix: string,
  accountId: string,
): string {
  const resolved = resolveIdempotencyKey(box.current, prefix, accountId);
  box.current = resolved.pending;
  return resolved.key;
}

type MaybeAxiosError = {
  response?: { status?: number; data?: { code?: string; message?: string; error?: { code?: string } } };
  code?: string;
  message?: string;
};

/**
 * 资金操作失败时的文案。区分三种情形，因为操作者的下一步动作完全不同：
 *   409 幂等冲突 → 不要再提交,先刷新核对
 *   超时/网关错误 → 结果未知,重试是安全的(会复用同一键)
 *   其他 → 原样透出服务端消息
 */
/** 超时类失败:结果未知,可以用同一幂等键安全重试(重试即确认)。 */
export function isTimeoutLikeError(err: unknown): boolean {
  const e = (err ?? {}) as MaybeAxiosError;
  const status = e.response?.status;
  return status === 502 || status === 503 || status === 504
    || e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT';
}

export function describeFundingError(err: unknown, fallback: string): string {
  const e = (err ?? {}) as MaybeAxiosError;
  const status = e.response?.status;
  const code = e.response?.data?.code ?? e.response?.data?.error?.code ?? e.code;

  if (status === 409 && String(code ?? '').includes('idempotency')) {
    return '本次提交的参数与上一次重试不一致。上一笔可能已经生效，请先关闭弹窗、刷新核对余额，确认后再重新操作。';
  }
  if (isTimeoutLikeError(err)) {
    // ⚠️ 必须强调「不要关闭弹窗」:关闭会清空 pending 幂等键(这是有意的,为了支持
    // 连做两笔同额操作),关掉重开再提交就是**第二笔真扣款**。
    return '多次确认后仍无法判定结果 —— 这笔操作可能已经生效。'
      + '请勿关闭本弹窗、也不要重复提交；先另开页面刷新核对余额，确认未生效后再重试。';
  }
  return e.response?.data?.message || e.message || fallback;
}

const DEFAULT_CONFIRM_ATTEMPTS = 4;
const DEFAULT_CONFIRM_DELAY_MS = 5_000;

/**
 * 提交资金操作，超时后用**同一幂等键**自动重提来确认结果。
 *
 * 为什么重试就是确认:服务端在同一事务里写幂等记录,同 key 再来会走回放并返回原结果。
 * 所以：
 *   - 第一次其实已提交 → 重提命中回放 → 拿到成功结果,操作者看到的就是成功
 *   - 第一次没提交     → 重提真正执行
 *   - 第一次仍在跑     → 重提在账户行锁上排队,等它结束后读到幂等记录再回放,顺序天然正确
 *
 * 非超时类错误(参数错、409 幂等冲突等)立即抛出,不重试 —— 那些重试没有意义,
 * 而 409 更是明确的「不要再提交」信号。
 */
export async function submitWithReplayConfirmation<T>(
  submit: () => Promise<T>,
  options: {
    attempts?: number;
    delayMs?: number;
    sleep?: (ms: number) => Promise<void>;
    onConfirming?: (attempt: number, total: number) => void;
  } = {},
): Promise<T> {
  const attempts = options.attempts ?? DEFAULT_CONFIRM_ATTEMPTS;
  const delayMs = options.delayMs ?? DEFAULT_CONFIRM_DELAY_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await submit();
    } catch (err) {
      if (!isTimeoutLikeError(err)) throw err;
      lastError = err;
      if (attempt < attempts) {
        options.onConfirming?.(attempt, attempts);
        await sleep(delayMs);
      }
    }
  }
  throw lastError;
}
