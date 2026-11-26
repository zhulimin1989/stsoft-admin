import api from '../axios';

export interface RechargeTier {
  id: string;
  productId: string;
  amountCents: number;
  bonusType: 'FIXED' | 'PERCENT';
  bonusValue: number; // FIXED: 美分, PERCENT: 百分比 (例如 20 表示 20%)
  badge?: string | null;
  sortOrder: number;
  isActive: boolean;
  startAt?: string | null;
  endAt?: string | null;
  /** 软提示: 同 productId+amountCents 已有其他启用 tier */
  overlapWarning?: string;
}

export interface RechargeTierProduct {
  id: string;
  name: string;
  slug?: string;
  billingMode?: 'SUBSCRIPTION' | 'PAY_AS_YOU_GO' | 'CODING_PLAN';
  isActive?: boolean;
}

export const rechargeTierApi = {
  list: (
    params: { productId?: string; isActive?: boolean } = {},
  ): Promise<{ items: RechargeTier[]; total: number }> =>
    api
      .get('/admin/v2/recharge-tiers', { params })
      .then((r) => r.data.data),
  get: (id: string): Promise<RechargeTier> =>
    api.get(`/admin/v2/recharge-tiers/${id}`).then((r) => r.data.data),
  products: (): Promise<{ items: RechargeTierProduct[] }> =>
    api.get('/admin/v2/recharge-tiers/products').then((r) => r.data.data),
  create: (data: Partial<RechargeTier>): Promise<RechargeTier> =>
    api.post('/admin/v2/recharge-tiers', data).then((r) => r.data.data),
  update: (id: string, data: Partial<RechargeTier>): Promise<RechargeTier> =>
    api
      .put(`/admin/v2/recharge-tiers/${id}`, data)
      .then((r) => r.data.data),
  delete: (id: string): Promise<void> =>
    api
      .delete(`/admin/v2/recharge-tiers/${id}`)
      .then((r) => r.data.data),
  clone: (id: string): Promise<RechargeTier> =>
    api
      .post(`/admin/v2/recharge-tiers/${id}/clone`)
      .then((r) => r.data.data),
};
