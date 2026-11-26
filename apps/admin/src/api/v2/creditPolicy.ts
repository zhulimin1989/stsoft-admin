import api from '../axios';

export interface CreditPolicyConfig {
  id: string;
  scope: 'GLOBAL' | 'SEGMENT';
  segmentId?: string;
  allowOverdraft: boolean;
  defaultCreditLimitCents: number;
  triggerAction: 'SUSPEND' | 'ALERT' | 'EMAIL';
  recoveryCondition: 'ON_RECHARGE' | 'AFTER_DAYS' | 'MANUAL';
  recoveryDays?: number;
}

export interface OverdueUser {
  userId: string;
  email: string;
  productId: string;
  balanceCents: number;
  overdueDays: number;
  reason: string;
  creditLimitCents: number;
}

export const creditPolicyApi = {
  getGlobal: (productId: string): Promise<CreditPolicyConfig> =>
    api
      .get('/admin/v2/credit-policy/global', { params: { productId } })
      .then((r) => r.data.data),
  updateGlobal: (
    productId: string,
    data: Partial<CreditPolicyConfig>,
  ): Promise<CreditPolicyConfig> =>
    api
      .put('/admin/v2/credit-policy/global', { ...data, productId })
      .then((r) => r.data.data),
  listSegmentOverrides: (
    productId: string,
  ): Promise<{ items: CreditPolicyConfig[] }> =>
    api
      .get('/admin/v2/credit-policy/segments', { params: { productId } })
      .then((r) => r.data.data),
  upsertSegmentOverride: (
    productId: string,
    data: Partial<CreditPolicyConfig>,
  ): Promise<CreditPolicyConfig> =>
    api
      .post('/admin/v2/credit-policy/segments', { ...data, productId })
      .then((r) => r.data.data),
  listOverdueUsers: (
    params: { productId?: string; page?: number; pageSize?: number } = {},
  ): Promise<{ items: OverdueUser[]; total: number }> =>
    api
      .get('/admin/v2/credit-policy/overdue-users', { params })
      .then((r) => r.data.data),
};
