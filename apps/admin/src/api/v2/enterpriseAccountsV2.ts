import { secureRandomUuid } from '../../utils/secureRandomUuid';
import api from '../axios';
import type {
  EnterpriseAccount,
  EnterpriseAccountCredit,
  EnterpriseAccountOwnerMember,
} from './enterpriseAccounts';

export type { EnterpriseAccount, EnterpriseAccountCredit, EnterpriseAccountOwnerMember };

export interface EnterpriseAccountV2 extends EnterpriseAccount {
  phone?: string | null;
  email?: string | null;
  earliestDueAt?: string | null;
  /** earliestDueAt 是否来自授信当月预计死线 */
  earliestDueProjected?: boolean;
  dueWarning?: boolean;
  prepaid?: boolean;
  ownerMembers?: EnterpriseAccountOwnerMember[];
}

export interface EnterpriseBillRow {
  yearMonth: string;
  currentMonth: boolean;
  requestCount: number;
  tokenTotal: number;
  consumeCents: number;
  accountPayCents: number;
  voucherDeductCents: number;
  creditPayCents: number;
  debtPayCents: number;
  adjustedCents: number;
  issuedVoucherCents: number;
  receivableCents: number;
  paidCents: number;
  pendingCents: number;
  status: '待核销' | '已核销';
  termsDays: number | null;
  dueAt: string | null;
  /** 授信当月预计死线（未冻结）；预付款为 false */
  dueProjected?: boolean;
  originalDueAt: string | null;
  extended: boolean;
  remainingDays: number | null;
  prepaid: boolean;
  writeOffDisabledReason: string | null;
  adjustDisabledReason: string | null;
  extendDisabledReason: string | null;
  compensateDisabledReason: string | null;
}

/** 与 admin 转发 billing 作业超时一致（INTERNAL_JOB_TIMEOUT_MS 默认 15 分钟）。 */
export const MONTH_SUMMARY_JOB_TIMEOUT_MS = 15 * 60 * 1000;

export interface MonthSummaryRefreshResult {
  skipped?: boolean;
  yearMonth: string | null;
  processed: number;
  fundingProcessed: number;
}

export interface MonthSummaryCloseResult {
  skipped: boolean;
  yearMonth: string | null;
  yearMonths?: string[];
  processed: number;
  hasMore: boolean;
  billingAccountId?: string | null;
}

export const enterpriseAccountV2Api = {
  list: (params: {
    page?: number;
    pageSize?: number;
    search?: string;
    status?: string;
  }) => api.get('/admin/v2/enterprise-accounts', { params }).then((r) => r.data.data),

  refreshMonthSummaries: () =>
    api.post('/admin/v2/enterprise-bill-month-summaries/refresh', undefined, {
      timeout: MONTH_SUMMARY_JOB_TIMEOUT_MS,
    }).then((r) => r.data.data as MonthSummaryRefreshResult),

  closeHistoricalMonths: (opts?: { billingAccountId?: string }) =>
    api.post(
      '/admin/v2/enterprise-bill-month-summaries/close',
      opts?.billingAccountId ? { billingAccountId: opts.billingAccountId } : undefined,
      { timeout: MONTH_SUMMARY_JOB_TIMEOUT_MS },
    ).then((r) => r.data.data as MonthSummaryCloseResult),

  get: (id: string) =>
    api.get(`/admin/v2/enterprise-accounts/${id}`).then((r) => r.data.data),

  listBills: (id: string, opts?: { buttonVisible?: boolean }) =>
    api.get(`/admin/v2/enterprise-accounts/${id}/bills`, {
      params: { button_visible: opts?.buttonVisible ?? false },
    }).then((r) => r.data.data),

  writeOff: (id: string, yearMonth: string, body: {
    amountCents: number;
    note: string;
    idempotencyKey: string;
  }) =>
    api.post(`/admin/v2/enterprise-accounts/${id}/bills/${yearMonth}/write-off`, body)
      .then((r) => r.data.data),

  adjust: (id: string, yearMonth: string, body: {
    direction: 'increase' | 'decrease';
    amountCents: number;
    note: string;
    idempotencyKey: string;
  }) => api.post(`/admin/v2/enterprise-accounts/${id}/bills/${yearMonth}/adjust`, body)
    .then((r) => r.data.data),

  compensateVoucher: (id: string, yearMonth: string, body: {
    amountCents: number;
    note: string;
    productId: string;
    tenantId?: string | null;
    idempotencyKey: string;
  }) => api.post(`/admin/v2/enterprise-accounts/${id}/bills/${yearMonth}/compensate-voucher`, body)
    .then((r) => r.data.data),

  extend: (id: string, yearMonth: string, body: { dueAt: string; idempotencyKey: string }) =>
    api.post(`/admin/v2/enterprise-accounts/${id}/bills/${yearMonth}/extend`, body)
      .then((r) => r.data.data),

  downloadHref: (id: string, yearMonth: string) =>
    `/api/admin/v2/enterprise-accounts/${id}/bills/${yearMonth}/download`,

  /**
   * 先走 axios 刷新会话，再把下载放到独立的隐藏框架里交给浏览器。
   * 页面不读取响应体。框架留在 document.body，切换账单或菜单不会中止这次下载。
   */
  download: async (id: string, yearMonth: string, fallbackFilename: string) => {
    await api.get('/admin/auth/profile');
    const frameName = `enterprise-bill-download-${secureRandomUuid()}`;
    const iframe = document.createElement('iframe');
    iframe.name = frameName;
    iframe.hidden = true;
    iframe.title = fallbackFilename;
    document.body.appendChild(iframe);
    const link = document.createElement('a');
    link.href = enterpriseAccountV2Api.downloadHref(id, yearMonth);
    link.target = frameName;
    link.download = fallbackFilename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  },

  recharge: (id: string, body: {
    amountCents: number;
    productId: string;
    description: string;
    idempotencyKey: string;
  }) => api.post(`/admin/v2/enterprise-accounts/${id}/recharge`, body).then((r) => r.data.data),

  updateCredit: (id: string, body: Record<string, unknown>) =>
    api.put(`/admin/v2/enterprise-accounts/${id}/credit`, body).then((r) => r.data.data),

  listCreditEvents: (id: string) =>
    api.get(`/admin/v2/enterprise-accounts/${id}/credit-events`).then((r) => r.data.data),

  issueVoucher: (id: string, body: {
    tenantId: string;
    userId: string;
    productId?: string | null;
    amountCents: number;
    reason: string;
    expiresAt?: string | null;
    idempotencyKey: string;
  }) => api.post(`/admin/v2/enterprise-accounts/${id}/vouchers`, body).then((r) => r.data.data),

  attachTenant: (id: string, tenantId: string) =>
    api.post(`/admin/v2/enterprise-accounts/${id}/attach-tenant`, { tenantId }).then((r) => r.data.data),

  listTenants: (id: string) =>
    api.get(`/admin/v2/enterprise-accounts/${id}/tenants`).then((r) => r.data.data),

  listModelDiscounts: (id: string, productId: string) =>
    api.get(`/admin/v2/enterprise-accounts/${id}/model-discounts`, { params: { productId } })
      .then((r) => r.data.data),

  updateModelDiscounts: (id: string, body: Record<string, unknown>) =>
    api.put(`/admin/v2/enterprise-accounts/${id}/model-discounts`, body).then((r) => r.data.data),
};

