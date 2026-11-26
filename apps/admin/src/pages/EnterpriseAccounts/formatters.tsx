import { Input, Space } from 'antd';
import { Tag, type TagVariant } from '../../components/common';
import type { EnterpriseVerificationSnapshot } from '../../api/v2/enterpriseAccounts';
import { formatCurrencyCents, formatModelUnitPrice } from '../../utils/price';
import type { ProductOption } from './types';

// 账户账务态 → 展示。billing 端 status 字面量不完全固定，做容错。
export const ACCOUNT_STATUS_VARIANT: Record<string, TagVariant> = {
  active: 'success',
  ACTIVE: 'success',
  suspended: 'warn',
  SUSPENDED: 'warn',
  closed: 'muted',
  CLOSED: 'muted',
  deleted: 'error',
};

// provisioning 业务展示态（原六态 + 议题二批一的作废两态 = 八态）。
export const PROVISIONING_LABEL: Record<string, string> = {
  PENDING: '待处理',
  VERIFYING: '企业二要素核验中',
  PROVISIONING: '企业账户开通中',
  ACTIVE: '已开通',
  FAILED_RETRYABLE: '开通失败，可重试',
  FAILED_FINAL: '失败，需人工处理',
  VOIDING: '作废中，正在回收资源',
  VOIDED: '已作废',
};

export const PROVISIONING_VARIANT: Record<string, TagVariant> = {
  PENDING: 'muted',
  VERIFYING: 'proc',
  PROVISIONING: 'proc',
  ACTIVE: 'success',
  FAILED_RETRYABLE: 'warn',
  FAILED_FINAL: 'error',
  // 回收中＝处理中样式；已作废＝终态（非错误，是运营主动动作的结果）。
  VOIDING: 'proc',
  VOIDED: 'muted',
};

export const VERIFICATION_LABEL: Record<string, string> = {
  PENDING: '待核验',
  VERIFIED: '已认证',
  VERIFYING: '认证中',
  REJECTED: '已驳回',
};

export const VERIFICATION_VARIANT: Record<string, TagVariant> = {
  PENDING: 'warn',
  VERIFIED: 'success',
  VERIFYING: 'warn',
  REJECTED: 'error',
};

// 审核态（reviewStatus，§3.1）——与开通态（provisioning）正交，分开展示（G1）。
export const REVIEW_LABEL: Record<string, string> = {
  AWAITING_PAYMENT: '待付款',
  PENDING_REVIEW: '待审核',
  APPROVED: '已通过',
  REJECTED: '已驳回',
};

export const REVIEW_VARIANT: Record<string, TagVariant> = {
  AWAITING_PAYMENT: 'muted',
  PENDING_REVIEW: 'warn',
  APPROVED: 'success',
  REJECTED: 'error',
};

export const REVIEW_STATUS_OPTIONS = [
  { label: '待审核', value: 'PENDING_REVIEW' },
  { label: '待付款', value: 'AWAITING_PAYMENT' },
  { label: '已驳回', value: 'REJECTED' },
  { label: '已通过', value: 'APPROVED' },
  { label: '全部', value: '' },
];

export const REJECT_CATEGORY_OPTIONS = [
  { label: '打款信息问题（重新填写金额）', value: 'payment_proof' },
  { label: '企业信息问题（需重走认证）', value: 'enterprise_info' },
];

export function reviewTag(status?: string | null) {
  if (!status) return <span>—</span>;
  return (
    <Tag variant={REVIEW_VARIANT[status] ?? 'muted'}>
      {REVIEW_LABEL[status] ?? status}
    </Tag>
  );
}

export function accountStatusTag(status?: string | null) {
  if (!status) return <span>—</span>;
  return <Tag variant={ACCOUNT_STATUS_VARIANT[status] ?? 'muted'}>{status}</Tag>;
}

export function provisioningTag(status?: string | null) {
  if (!status) return <span>—</span>;
  return (
    <Tag variant={PROVISIONING_VARIANT[status] ?? 'muted'}>
      {PROVISIONING_LABEL[status] ?? status}
    </Tag>
  );
}

export function verificationTag(status?: string | null, badgeStatus?: string | null) {
  const displayStatus = badgeStatus || status;
  if (!displayStatus) return <span>—</span>;
  return (
    <Tag variant={VERIFICATION_VARIANT[displayStatus] ?? 'muted'}>
      {VERIFICATION_LABEL[displayStatus] ?? displayStatus}
    </Tag>
  );
}

export function rawVerificationTag(status?: string | null) {
  if (!status) return <span>—</span>;
  return (
    <Tag variant={VERIFICATION_VARIANT[status] ?? 'muted'}>
      {VERIFICATION_LABEL[status] ?? status}
    </Tag>
  );
}

export function fmtDateTime(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('zh-CN', { hour12: false });
}

export function formatMoneyCents(value: number | null | undefined, currency: string): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return formatCurrencyCents(value, currency, { emptyText: '—' });
}

export function formatMoneyAmount(
  value: number | string | null | undefined,
  currency: string,
): string {
  if (value == null || value === '') return '—';
  const amount = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(amount)) return String(value);
  return formatCurrencyCents(Math.round(amount * 100), currency, { emptyText: '—' });
}

export function formatUsageMultiplier(value?: number | string | null): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  return `${amount.toFixed(4)}x`;
}

export function toFiniteNumber(
  value: number | string | null | undefined,
  fallback: number,
): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : fallback;
}

/** 最小可入账金额：1 分。0 / 负值 / 不足 1 分不得钳成 0.01 后提交。 */
export const MIN_POSITIVE_YUAN = 0.01;

export function yuanToPositiveCents(value: unknown): number | null {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < MIN_POSITIVE_YUAN) return null;
  const cents = Math.round(amount * 100);
  return cents > 0 ? cents : null;
}

export function positiveYuanAmountRule(message: string) {
  return {
    validator: async (_: unknown, value: unknown) => {
      if (value == null || value === '') return;
      if (yuanToPositiveCents(value) == null) {
        throw new Error(message);
      }
    },
  };
}

export function isPaygProduct(product: ProductOption): boolean {
  return product.isActive !== false && /PAY_AS_YOU_GO|payg/i.test(product.billingMode ?? '');
}

export function formatEnterpriseModelPrice(
  value: number | null | undefined,
  currency: string,
): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return formatModelUnitPrice(value, currency, { unit: '', emptyText: '—' });
}

export function formatCnyAmount(value?: number | string | null): string {
  if (value == null || value === '') return '—';
  const amount = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(amount)) return String(value);
  return `¥${amount.toFixed(2)}`;
}

export function parseProvisioningError(raw?: string | null): {
  reason: string;
  code: string | null;
  suggestion: string;
  raw: string;
} | null {
  const message = raw?.trim();
  if (!message) return null;
  const bracketCode = message.match(/\[([a-z0-9_]+)\]/i)?.[1] ?? null;
  const code = bracketCode ?? (message.includes('enterprise_uscc_conflict') ? 'enterprise_uscc_conflict' : null);
  if (code === 'enterprise_uscc_conflict') {
    return {
      reason: '统一社会信用代码已存在启用中的企业账户',
      code,
      suggestion: '请确认是否已有同统一社会信用代码的企业账户；如需重新开通，先处理/释放历史企业账户。作废退回会回收本次开通的企业资源，之后重新开通需平台处理（墓碑会拒绝用户自助重提）。',
      raw: message,
    };
  }
  return {
    reason: '企业账户开通失败',
    code,
    suggestion: '请结合原始错误排查 billing 企业账户创建、tenant 挂载或内部服务调用状态；必要时作废退回（会回收企业资源，之后重新开通需平台处理）。',
    raw: message,
  };
}

export function ProvisioningErrorDetail({ error }: { error?: string | null }) {
  const parsed = parseProvisioningError(error);
  if (!parsed) return <span>—</span>;
  return (
    <div>
      <Space direction="vertical" size={6} style={{ width: '100%' }}>
        <span>{parsed.reason}</span>
        {parsed.code ? (
          <span>
            错误码：<code>{parsed.code}</code>
          </span>
        ) : null}
        <span style={{ color: '#666' }}>处理建议：{parsed.suggestion}</span>
        <Input.TextArea
          readOnly
          rows={2}
          value={parsed.raw}
          style={{ fontFamily: 'monospace', fontSize: 12 }}
        />
      </Space>
    </div>
  );
}

/** FAILED_RETRYABLE 时才允许 retry（§10.3 provisioning_not_retryable）。 */
export function canRetry(v: EnterpriseVerificationSnapshot | null): boolean {
  return v?.provisioningStatus === 'FAILED_RETRYABLE';
}
