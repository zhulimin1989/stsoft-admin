import api from '../axios';
import type { RiskRuleType } from './riskRules';

export type RiskSeverity = 'HIGH' | 'MEDIUM' | 'LOW';
export type RiskFlagStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'RELEASED'
  | 'PERMANENT_BAN';

export interface RiskFlag {
  id: string;
  userId: string;
  userEmail?: string | null;
  userNickname?: string;
  ruleId?: string | null;
  ruleName?: string | null;
  ruleType: RiskRuleType;
  severity: RiskSeverity;
  context: Record<string, unknown>;
  status: RiskFlagStatus;
  triggeredAt: string;
  resolvedAt?: string | null;
  resolvedBy?: string | null;
  resolveNote?: string | null;
}

export interface RelatedUserItem {
  userId: string;
  userEmail: string | null;
  userNickname: string;
  sharedSignal: string;
  flagCount: number;
}

export interface RiskAuditLogItem {
  id: string;
  action: string;
  operatorId: string | null;
  note: string | null;
  createdAt: string;
}

export const riskUserApi = {
  list: (
    params: {
      page?: number;
      pageSize?: number;
      search?: string;
      ruleType?: RiskRuleType;
      severity?: RiskSeverity;
      status?: RiskFlagStatus;
      userId?: string;
      triggeredFrom?: string;
      triggeredTo?: string;
    } = {},
  ): Promise<{
    items: RiskFlag[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> => api.get('/admin/v2/risk-users', { params }).then((r) => r.data.data),
  get: (id: string): Promise<RiskFlag> =>
    api.get(`/admin/v2/risk-users/${id}`).then((r) => r.data.data),
  related: (
    id: string,
  ): Promise<{ items: RelatedUserItem[]; mode: 'IP' | 'TODO' }> =>
    api
      .get(`/admin/v2/risk-users/${id}/related`)
      .then((r) => r.data.data),
  history: (id: string): Promise<{ items: RiskFlag[] }> =>
    api.get(`/admin/v2/risk-users/${id}/history`).then((r) => r.data.data),
  auditLogs: (id: string): Promise<{ items: RiskAuditLogItem[] }> =>
    api.get(`/admin/v2/risk-users/${id}/audit-logs`).then((r) => r.data.data),
  release: (id: string, note: string): Promise<RiskFlag> =>
    api
      .post(`/admin/v2/risk-users/${id}/release`, { note })
      .then((r) => r.data.data),
  permanentBan: (id: string, reason: string): Promise<RiskFlag> =>
    api
      .post(`/admin/v2/risk-users/${id}/ban`, { reason })
      .then((r) => r.data.data),
};
