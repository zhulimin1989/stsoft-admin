import api from '../axios';

export interface FunnelData {
  steps: Array<{ key: string; label: string; value: number }>;
  comparedTo?: { steps: Array<{ key: string; value: number }> };
}

export const funnelApi = {
  getFunnel: (
    params: { days?: number; segmentId?: string } = {},
  ): Promise<FunnelData> =>
    api.get('/admin/v2/funnel', { params }).then((r) => r.data.data),
  getSubscriptionFunnel: (
    params: { days?: number } = {},
  ): Promise<FunnelData> =>
    api
      .get('/admin/v2/funnel/subscription', { params })
      .then((r) => r.data.data),
  getPaygFunnel: (params: { days?: number } = {}): Promise<FunnelData> =>
    api.get('/admin/v2/funnel/payg', { params }).then((r) => r.data.data),
};
