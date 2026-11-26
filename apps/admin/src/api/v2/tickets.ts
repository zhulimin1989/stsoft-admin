import api from '../axios';

export interface Ticket {
  id: string;
  ticketNumber: string; // TKT-YYYYMMDD-NNNNN
  userId: string;
  subject: string;
  category: 'BILLING' | 'TECHNICAL' | 'REFUND' | 'FEATURE' | 'OTHER';
  priority: 'URGENT' | 'HIGH' | 'NORMAL' | 'LOW';
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
  assigneeId?: string;
  createdAt: string;
  resolvedAt?: string;
  closedAt?: string;
}

export interface TicketMessage {
  id: string;
  ticketId: string;
  authorType: 'USER' | 'ADMIN' | 'SYSTEM';
  authorId: string;
  content: string;
  attachments: string[];
  isInternal: boolean;
  createdAt: string;
}

export const ticketApi = {
  list: (
    params: {
      page?: number;
      pageSize?: number;
      search?: string;
      category?: string;
      priority?: string;
      status?: string;
      assigneeId?: string;
      userId?: string;
      createdFrom?: string;
      createdTo?: string;
    } = {},
  ): Promise<{ items: Ticket[]; total: number }> =>
    api.get('/admin/v2/tickets', { params }).then((r) => r.data.data),
  get: (
    id: string,
  ): Promise<{
    ticket: Ticket;
    messages: TicketMessage[];
    user: {
      id: string;
      email: string | null;
      nickname: string;
      plan?: string;
      totalSpent?: number;
      recentOrders?: Array<{ id: string; amount: number; createdAt: string }>;
    } | null;
  }> => api.get(`/admin/v2/tickets/${id}`).then((r) => r.data.data),
  create: (data: {
    userId: string;
    subject: string;
    category: Ticket['category'];
    priority?: Ticket['priority'];
    content?: string;
  }): Promise<Ticket> =>
    api.post('/admin/v2/tickets', data).then((r) => r.data.data),
  reply: (
    id: string,
    content: string,
    isInternal: boolean = false,
    attachments: string[] = [],
  ): Promise<TicketMessage> =>
    api
      .post(`/admin/v2/tickets/${id}/messages`, {
        content,
        isInternal,
        attachments,
      })
      .then((r) => r.data.data),
  updateStatus: (id: string, status: string): Promise<void> =>
    api
      .patch(`/admin/v2/tickets/${id}/status`, { status })
      .then((r) => r.data.data),
  assign: (id: string, assigneeId: string | null): Promise<void> =>
    api
      .patch(`/admin/v2/tickets/${id}/assign`, { assigneeId })
      .then((r) => r.data.data),
  updateCategory: (id: string, category: Ticket['category']): Promise<void> =>
    api
      .patch(`/admin/v2/tickets/${id}/category`, { category })
      .then((r) => r.data.data),
  updatePriority: (id: string, priority: Ticket['priority']): Promise<void> =>
    api
      .patch(`/admin/v2/tickets/${id}/priority`, { priority })
      .then((r) => r.data.data),
  close: (id: string): Promise<void> =>
    api.post(`/admin/v2/tickets/${id}/close`).then((r) => r.data.data),
  merge: (id: string, targetId: string): Promise<void> =>
    api
      .post(`/admin/v2/tickets/${id}/merge`, { targetId })
      .then((r) => r.data.data),
};
