import api from '../axios';

export type RiskRuleType =
  | 'BLACKLIST'
  | 'USAGE_THRESHOLD'
  | 'IP_LIMIT'
  | 'REFUND_RATE'
  | 'FRAUD_PROVIDER';

export type RiskAction = 'BLOCK' | 'ALERT' | 'DISABLE_KEY' | 'FREEZE_USER';

export type RiskListType = 'EMAIL' | 'DOMAIN' | 'IP' | 'CARD_HASH' | 'USER_ID';

export interface RiskRule {
  id: string;
  name: string;
  ruleType: RiskRuleType;
  config: Record<string, unknown>;
  action: RiskAction;
  isActive: boolean;
  triggerCount: number;
  lastTriggeredAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface RiskListEntry {
  id: string;
  ruleId?: string | null;
  listType: RiskListType;
  value: string;
  reason: string;
  addedBy: string;
  expiresAt?: string;
  createdAt: string;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export const riskRuleApi = {
  listRules: (
    params: {
      ruleType?: RiskRuleType;
      isActive?: boolean;
      page?: number;
      pageSize?: number;
    } = {},
  ): Promise<PaginatedResult<RiskRule>> =>
    api.get('/admin/v2/risk-rules', { params }).then((r) => r.data.data),
  getRule: (id: string): Promise<RiskRule> =>
    api.get(`/admin/v2/risk-rules/${id}`).then((r) => r.data.data),
  createRule: (data: {
    name: string;
    ruleType: RiskRuleType;
    action: RiskAction;
    config: Record<string, unknown>;
    isActive?: boolean;
    confirmDangerousAction?: boolean;
  }): Promise<RiskRule> =>
    api.post('/admin/v2/risk-rules', data).then((r) => r.data.data),
  updateRule: (
    id: string,
    data: Partial<RiskRule> & { confirmDangerousAction?: boolean },
  ): Promise<RiskRule> =>
    api.put(`/admin/v2/risk-rules/${id}`, data).then((r) => r.data.data),
  deleteRule: (id: string): Promise<void> =>
    api.delete(`/admin/v2/risk-rules/${id}`).then((r) => r.data.data),
  // Risk list (blacklist) sub-resource
  listEntries: (
    params: {
      listType?: RiskListType;
      search?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ): Promise<PaginatedResult<RiskListEntry>> =>
    api
      .get('/admin/v2/risk-rules/list-entries', { params })
      .then((r) => r.data.data),
  addEntry: (data: {
    listType: RiskListType;
    value: string;
    reason?: string;
    expiresAt?: string;
    ruleId?: string | null;
  }): Promise<RiskListEntry> =>
    api
      .post('/admin/v2/risk-rules/list-entries', data)
      .then((r) => r.data.data),
  removeEntry: (id: string): Promise<void> =>
    api
      .delete(`/admin/v2/risk-rules/list-entries/${id}`)
      .then((r) => r.data.data),
};
