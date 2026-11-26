import api from '../axios';

export interface Alert {
  id: string;
  category: 'PAYMENT' | 'CHANNEL' | 'USAGE' | 'SECURITY' | 'SYSTEM';
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  status: 'PENDING' | 'READ' | 'HANDLED';
  title: string;
  message: string;
  sourceType?: string | null;
  sourceId?: string | null;
  userId?: string | null;
  context: string | Record<string, unknown>;
  readAt?: string | null;
  handledAt?: string;
  handledBy?: string | null;
  handleNote?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export const alertApi = {
  list: (
    params: {
      page?: number;
      pageSize?: number;
      category?: string;
      severity?: string;
      status?: string;
      search?: string;
      fromDate?: string;
      toDate?: string;
    } = {},
  ): Promise<{ items: Alert[]; total: number }> =>
    api.get('/admin/v2/alerts', { params }).then((r) => r.data.data),
  get: (id: string): Promise<Alert> =>
    api.get(`/admin/v2/alerts/${id}`).then((r) => r.data.data),
  markRead: (ids: string[]): Promise<void> =>
    api
      .post('/admin/v2/alerts/mark-read', { ids })
      .then((r) => r.data.data),
  handle: (id: string, note: string): Promise<void> =>
    api
      .post(`/admin/v2/alerts/${id}/handle`, { note })
      .then((r) => r.data.data),
};
