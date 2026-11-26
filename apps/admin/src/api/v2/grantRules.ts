import api from '../axios';

export interface CreditGrantRule {
  id: string;
  name: string;
  triggerType:
    | 'DAILY_CRON'
    | 'FIRST_LOGIN'
    | 'DAILY_CHECKIN'
    | 'TASK_COMPLETE'
    | 'WEEKLY_CRON';
  cronExpr?: string;
  segmentId?: string;
  rewardType: 'CREDIT' | 'BALANCE' | 'BOOSTER_PACK';
  rewardAmount: number;
  productId?: string;
  expirePolicy: 'PERMANENT' | 'SAME_DAY_END' | 'N_DAYS' | 'NEXT_RESET';
  expireDays?: number;
  perUserLimit: number;
  globalDailyCap?: number;
  isActive: boolean;
  startAt?: string;
  endAt?: string;
  notifyType?: 'INAPP' | 'EMAIL' | 'SMS' | 'NONE';
  notifyTemplate?: string;
}

export interface GrantRedemption {
  id: string;
  ruleId: string;
  userId: string;
  amount: number;
  expiresAt?: string;
  isExpired: boolean;
  isUsedUp: boolean;
  createdAt: string;
}

export const grantRuleApi = {
  list: (
    params: {
      page?: number;
      pageSize?: number;
      search?: string;
      triggerType?: string;
      isActive?: boolean;
      segmentId?: string;
    } = {},
  ): Promise<{ items: CreditGrantRule[]; total: number }> =>
    api.get('/admin/v2/grant-rules', { params }).then((r) => r.data.data),
  get: (id: string): Promise<CreditGrantRule> =>
    api.get(`/admin/v2/grant-rules/${id}`).then((r) => r.data.data),
  create: (data: Partial<CreditGrantRule>): Promise<CreditGrantRule> =>
    api.post('/admin/v2/grant-rules', data).then((r) => r.data.data),
  update: (
    id: string,
    data: Partial<CreditGrantRule>,
  ): Promise<CreditGrantRule> =>
    api.put(`/admin/v2/grant-rules/${id}`, data).then((r) => r.data.data),
  delete: (id: string): Promise<void> =>
    api.delete(`/admin/v2/grant-rules/${id}`).then((r) => r.data.data),
  preview: (
    id: string,
  ): Promise<{
    matchedCount: number;
    estimatedTotalAmount: number;
    sampleUserIds?: string[];
  }> =>
    api
      .post(`/admin/v2/grant-rules/${id}/preview`)
      .then((r) => r.data.data),
  manualTrigger: (
    id: string,
  ): Promise<{
    ruleId: string;
    attemptedUsers: number;
    granted: number;
    skippedPerUserLimit: number;
    skippedCap: number;
    failed: number;
    totalAmount: number;
  }> =>
    api
      .post(`/admin/v2/grant-rules/${id}/manual-trigger`)
      .then((r) => r.data.data),
  listRedemptions: (
    id: string,
    params: { page?: number; pageSize?: number } = {},
  ): Promise<{ items: GrantRedemption[]; total: number }> =>
    api
      .get(`/admin/v2/grant-rules/${id}/redemptions`, { params })
      .then((r) => r.data.data),
};
