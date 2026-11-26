import { Tag } from '../../components/common';
import { formatCurrencyCents } from '../../utils/price';

export function formatMoneyCents(value: number | null | undefined, currency: string): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return formatCurrencyCents(value, currency, { emptyText: '—' });
}

/** 列表勾稽：应收 = 消耗 − 券扣 − 账户支付 + 调整 − 发券；待付款 = 应收 − 已付款。 */
export function previewBillMoney(bill: {
  consumeCents: number;
  accountPayCents?: number;
  voucherDeductCents?: number;
  adjustedCents: number;
  issuedVoucherCents?: number;
  paidCents: number;
}, next?: { adjustedCents?: number; issuedVoucherCents?: number }) {
  const receivableCents = bill.consumeCents
    - (bill.voucherDeductCents ?? 0)
    - (bill.accountPayCents ?? 0)
    + (next?.adjustedCents ?? bill.adjustedCents)
    - (next?.issuedVoucherCents ?? bill.issuedVoucherCents ?? 0);
  return {
    receivableCents,
    pendingCents: receivableCents - bill.paidCents,
  };
}

export function moneyText(value: number | null | undefined, currency: string) {
  const text = formatMoneyCents(value, currency);
  if (typeof value === 'number' && value < 0) {
    return <span style={{ color: '#cf1322' }}>{text}</span>;
  }
  return text;
}

export function fmtDateTime(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  // sv-SE → yyyy-MM-dd HH:mm:ss（补零）；再换成 / 与现有展示习惯一致
  const stamped = d.toLocaleString('sv-SE', {
    hour12: false,
    timeZone: 'Asia/Shanghai',
  });
  return stamped.replace(/-/g, '/');
}

export function accountStatusTag(status?: string | null) {
  if (!status) return <span>—</span>;
  const variant = status === 'active' || status === 'ACTIVE' ? 'success'
    : status === 'suspended' || status === 'SUSPENDED' ? 'warn'
    : 'muted';
  return <Tag variant={variant}>{status}</Tag>;
}

/** 信用状态：启用 / 停用 / 已失效（逾期）；未知码原样回退。 */
export function creditStatusLabel(status?: string | null): string {
  if (!status) return '—';
  switch (status) {
    case 'ACTIVE':
      return '启用';
    case 'DISABLED':
      return '停用';
    case 'SUSPENDED':
      return '已失效（逾期）';
    default:
      return status;
  }
}

/** 预付款 ⇔ 未启用授信；启用授信时写「自然月结算 + N 天回款」。 */
export function fundingModeText(
  prepaid: boolean | undefined,
  termsDays: number | null | undefined,
): string {
  if (prepaid) return '预付款';
  if (typeof termsDays === 'number' && Number.isFinite(termsDays)) {
    return `信用额度（额度 + 自然月结算 + ${termsDays} 天回款）`;
  }
  return '信用额度（额度 + 自然月结算 + N 天回款）';
}

export function dash(value?: string | number | null): string {
  if (value == null || value === '') return '—';
  return String(value);
}

/** Owner 成员为空时按 story 21 显示「无」，区别于其它空字段的「—」。 */
export function dashOwner(value?: string | null): string {
  if (value == null || value === '') return '无';
  return String(value);
}

export function mono(value?: string | number | null) {
  const text = dash(value);
  return <span className="ea-v2-mono">{text}</span>;
}

/** PRD §4.3：已认证 / 未认证 / 审核中；驳回单独标出。 */
export function certStatusTag(
  status?: string | null,
  badgeStatus?: string | null,
) {
  const code = badgeStatus || status;
  if (!code) {
    return <Tag variant="muted">未认证</Tag>;
  }
  switch (code) {
    case 'VERIFIED':
      return <Tag variant="success">已认证</Tag>;
    case 'VERIFYING':
    case 'PENDING':
      return <Tag variant="warn">审核中</Tag>;
    case 'REJECTED':
      return <Tag variant="error">已驳回</Tag>;
    default:
      return <Tag variant="muted">{code}</Tag>;
  }
}

/** ENTERPRISE → 企业实名认证。 */
export function certTypeLabel(type?: string | null): string {
  if (!type) return '—';
  if (type === 'ENTERPRISE' || type === 'enterprise') return '企业实名认证';
  return type;
}
