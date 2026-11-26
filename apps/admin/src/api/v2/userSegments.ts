import api from '../axios';

export interface UserSegment {
  id: string;
  name: string;
  description: string;
  ruleType: 'STATIC' | 'DYNAMIC';
  ruleExpr?: string;
  memberCount: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserSegmentListResp {
  items: UserSegment[];
  total: number;
}

export interface UserSegmentMember {
  userId: string;
  joinedAt: string | null;
  user: {
    id: string;
    email: string;
    nickname: string | null;
    createdAt: string;
  } | null;
}

export interface UserSegmentMemberListResp {
  items: UserSegmentMember[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface UserSegmentReferences {
  grantRules: Array<{ id: string; name: string }>;
  creditPolicies: Array<{ id: string; name: string }>;
  campaigns: Array<{ id: string; name: string }>;
  discountCodes: Array<{ id: string; code: string }>;
}

export interface UserSegmentAddMembersResp {
  added: number;
  skipped: number;
  missing: string[];
}

export const userSegmentApi = {
  list: (
    params: {
      page?: number;
      pageSize?: number;
      search?: string;
      ruleType?: string;
      isActive?: boolean;
    } = {},
  ): Promise<UserSegmentListResp> =>
    api.get('/admin/v2/user-segments', { params }).then((r) => r.data.data),
  get: (id: string): Promise<UserSegment> =>
    api.get(`/admin/v2/user-segments/${id}`).then((r) => r.data.data),
  create: (data: Partial<UserSegment>): Promise<UserSegment> =>
    api.post('/admin/v2/user-segments', data).then((r) => r.data.data),
  update: (id: string, data: Partial<UserSegment>): Promise<UserSegment> =>
    api.put(`/admin/v2/user-segments/${id}`, data).then((r) => r.data.data),
  delete: (id: string): Promise<void> =>
    api.delete(`/admin/v2/user-segments/${id}`).then((r) => r.data.data),
  preview: (
    ruleExpr: string,
  ): Promise<{
    matchedCount: number;
    sampleUserIds: string[];
    capped: boolean;
    message?: string;
  }> =>
    api
      .post('/admin/v2/user-segments/preview', { ruleExpr })
      .then((r) => r.data.data),
  refresh: (id: string): Promise<void> =>
    api
      .post(`/admin/v2/user-segments/${id}/refresh`)
      .then((r) => r.data.data),
  listMembers: (
    id: string,
    params: { page?: number; pageSize?: number } = {},
  ): Promise<UserSegmentMemberListResp> =>
    api
      .get(`/admin/v2/user-segments/${id}/members`, { params })
      .then((r) => r.data.data),
  addMembers: (
    id: string,
    userIds: string[],
  ): Promise<UserSegmentAddMembersResp> =>
    api
      .post(`/admin/v2/user-segments/${id}/members`, { userIds })
      .then((r) => r.data.data),
  removeMember: (id: string, userId: string): Promise<void> =>
    api
      .delete(`/admin/v2/user-segments/${id}/members/${userId}`)
      .then((r) => r.data.data),
  references: (id: string): Promise<UserSegmentReferences> =>
    api
      .get(`/admin/v2/user-segments/${id}/references`)
      .then((r) => r.data.data),
};
