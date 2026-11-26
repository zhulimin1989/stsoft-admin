import api from '../axios';

export interface QuotaRule {
  windowType: 'ROLLING' | 'FIXED_PERIOD' | 'CUMULATIVE';
  durationLabel: string;
  durationSec: number;
  metric:
    | 'REQUESTS'
    | 'INPUT_TOKENS'
    | 'OUTPUT_TOKENS'
    | 'TOTAL_TOKENS'
    | 'CREDITS';
  limitValue: number;
  modelGroupId?: string | null;
}

export interface PlanQuotaTemplate {
  id: string;
  name: string;
  description: string;
  rules: QuotaRule[];
  referencedPlanIds: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface QuotaTemplateReferences {
  planIds: string[];
  count: number;
}

export interface PlanQuotaRuleBinding {
  id: string;
  planId: string;
  templateId: string;
  templateName: string;
  templateDescription: string;
  rules: QuotaRule[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

type QuotaTemplateListParams = {
  page?: number;
  pageSize?: number;
  search?: string;
  isActive?: boolean;
};

type QuotaTemplateListResponse = {
  items: PlanQuotaTemplate[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const API_PAGE_SIZE_MAX = 100;

export const quotaTemplateApi = {
  list: (params: QuotaTemplateListParams = {}): Promise<QuotaTemplateListResponse> =>
    api.get('/admin/v2/quota-templates', { params }).then((r) => r.data.data),
  listAll: async (
    params: Omit<QuotaTemplateListParams, 'page' | 'pageSize'> = {},
  ): Promise<PlanQuotaTemplate[]> => {
    const all: PlanQuotaTemplate[] = [];
    let page = 1;

    while (true) {
      const res = await quotaTemplateApi.list({
        ...params,
        page,
        pageSize: API_PAGE_SIZE_MAX,
      });
      all.push(...(res.items || []));
      if ((res.items?.length ?? 0) < API_PAGE_SIZE_MAX) break;
      if (all.length >= res.total) break;
      page += 1;
    }

    return all;
  },
  get: (id: string): Promise<PlanQuotaTemplate> =>
    api.get(`/admin/v2/quota-templates/${id}`).then((r) => r.data.data),
  create: (data: Partial<PlanQuotaTemplate>): Promise<PlanQuotaTemplate> =>
    api.post('/admin/v2/quota-templates', data).then((r) => r.data.data),
  update: (
    id: string,
    data: Partial<PlanQuotaTemplate>,
  ): Promise<PlanQuotaTemplate> =>
    api.put(`/admin/v2/quota-templates/${id}`, data).then((r) => r.data.data),
  delete: (id: string): Promise<void> =>
    api.delete(`/admin/v2/quota-templates/${id}`).then((r) => r.data.data),
  clone: (id: string): Promise<PlanQuotaTemplate> =>
    api
      .post(`/admin/v2/quota-templates/${id}/clone`)
      .then((r) => r.data.data),
  references: (id: string): Promise<QuotaTemplateReferences> =>
    api
      .get(`/admin/v2/quota-templates/${id}/references`)
      .then((r) => r.data.data),
  listPlanRules: (planId: string): Promise<PlanQuotaRuleBinding[]> =>
    api
      .get(`/admin/v2/quota-templates/plan/${encodeURIComponent(planId)}/rules`)
      .then((r) => r.data.data),
  replacePlanRules: (
    planId: string,
    templateIds: string[],
  ): Promise<PlanQuotaRuleBinding[]> =>
    api
      .put(`/admin/v2/quota-templates/plan/${encodeURIComponent(planId)}/rules`, { templateIds })
      .then((r) => r.data.data),
};
