import api from '../axios';

export interface ReferralProgram {
  id: string;
  name: string;
  inviterReward: number;
  inviteeReward: number;
  rewardCondition: 'REGISTER' | 'FIRST_RECHARGE' | 'FIRST_SUBSCRIBE';
  productId?: string;
  trackingOnly?: boolean;
  isActive: boolean;
  startAt?: string;
  endAt?: string;
  // 防作弊
  sameIpLimit?: number;
  sameDeviceLimit?: number;
  perUserInviteLimit?: number;
}

export interface ReferralRedemption {
  id: string;
  programId: string;
  inviterUserId: string;
  inviteeUserId: string;
  triggeredAt: string | null;
  rewardGranted: boolean;
  rejectReason?: string | null;
  createdAt: string;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  landingUrl?: string | null;
  capturedAt?: string | null;
  // 访客画像:地理(由 IP 解析)+ 访问来源(空=direct)
  country?: string | null;
  city?: string | null;
  referrer?: string | null;
  // 后端 join 出的邮箱(展示用,优先于 UUID)
  inviter?: {
    email: string | null;
    phone: string | null;
    nickname: string;
  } | null;
  invitee?: {
    email: string | null;
    phone: string | null;
    nickname: string;
  } | null;
}

export interface ReferralCodeResult {
  code: string;
  programId: string;
  inviterUserId?: string;
  inviterEmail?: string | null;
  inviterPhone?: string | null;
}

export interface ClickSourceRow {
  /** 来源页面 URL 或渠道名;direct=直接访问,(未标记)=无 utm_source */
  source: string;
  /** 去重访客数 */
  uv: number;
  /** 总点击数 */
  pv: number;
}

export interface ClickSources {
  byReferrer: ClickSourceRow[];
  byUtmSource: ClickSourceRow[];
}

export interface ReferralCodeRow {
  code: string;
  inviterUserId: string;
  inviter: { email: string | null; phone: string | null; nickname: string } | null;
  createdAt: string;
}

export interface ReferralSummary {
  totalInviters: number;
  totalInvitees: number;
  totalRedemptions: number;
  totalAttempts: number;
  /** 0..1;前端格式化成百分比 */
  conversionRate: number;
  totalRewardIssued: number;
  /** 去重点击人数(UV) */
  totalClickUv: number;
  /** 每个 program:成功发奖兑换数 + 去重点击 UV */
  perProgram: Record<string, { redemptionCount: number; clickUv: number }>;
}

export const referralApi = {
  listPrograms: (): Promise<{ items: ReferralProgram[] }> =>
    api.get('/admin/v2/referrals/programs').then((r) => r.data.data),
  createProgram: (data: Partial<ReferralProgram>): Promise<ReferralProgram> =>
    api
      .post('/admin/v2/referrals/programs', data)
      .then((r) => r.data.data),
  updateProgram: (
    id: string,
    data: Partial<ReferralProgram>,
  ): Promise<ReferralProgram> =>
    api
      .put(`/admin/v2/referrals/programs/${id}`, data)
      .then((r) => r.data.data),
  deleteProgram: (id: string): Promise<void> =>
    api
      .delete(`/admin/v2/referrals/programs/${id}`)
      .then((r) => r.data.data),
  generateCode: (
    programId: string,
    data: { inviterUser: string },
  ): Promise<ReferralCodeResult> =>
    api
      .post(`/admin/v2/referrals/programs/${programId}/codes`, data)
      .then((r) => r.data.data),
  listRedemptions: (
    params: {
      programId?: string;
      inviterUserId?: string;
      triggered?: boolean;
      page?: number;
      pageSize?: number;
    } = {},
  ): Promise<{ items: ReferralRedemption[]; total: number }> =>
    api
      .get('/admin/v2/referrals/redemptions', { params })
      .then((r) => r.data.data),
  leaderboard: (
    params: { programId?: string; days?: number } = {},
  ): Promise<{
    items: Array<{
      userId: string;
      email: string | null;
      phone: string | null;
      nickname: string | null;
      inviteCount: number;
      rewardTotal: number;
    }>;
  }> =>
    api
      .get('/admin/v2/referrals/leaderboard', { params })
      .then((r) => r.data.data),
  summary: (
    params: { programId?: string } = {},
  ): Promise<ReferralSummary> =>
    api
      .get('/admin/v2/referrals/summary', { params })
      .then((r) => r.data.data),
  clickSources: (programId: string): Promise<ClickSources> =>
    api
      .get('/admin/v2/referrals/click-sources', { params: { programId } })
      .then((r) => r.data.data),
  listCodes: (programId: string): Promise<{ items: ReferralCodeRow[] }> =>
    api
      .get('/admin/v2/referrals/codes', { params: { programId } })
      .then((r) => r.data.data),
};
