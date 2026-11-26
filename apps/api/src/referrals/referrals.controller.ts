import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiResponse } from '@ruidong/shared';
import { BillingInternalClient } from '../billing/billing-internal.client';
import { UserInternalClient } from '../user/user-internal.client';
import { RequireAdminPermission } from '../common/decorators/admin-permission.decorator';
import { AdminJwtAuthGuard } from '../common/guards/admin-jwt-auth.guard';
import { AdminPermissionGuard } from '../common/guards/admin-permission.guard';

type ReferralRewardCondition = 'REGISTER' | 'FIRST_RECHARGE' | 'FIRST_SUBSCRIBE';

interface ReferralProgramBody {
  name?: string;
  inviterReward?: number;
  inviteeReward?: number;
  rewardCondition?: ReferralRewardCondition;
  productId?: string | null;
  trackingOnly?: boolean;
  isActive?: boolean;
  startAt?: string | null;
  endAt?: string | null;
  sameIpLimit?: number | null;
  sameDeviceLimit?: number | null;
  perUserInviteLimit?: number | null;
}

interface ReferralCodeBody {
  inviterUser?: string;
  inviterUserId?: string;
  inviterEmail?: string;
}

function parseBooleanQuery(
  raw: string | boolean | undefined,
): boolean | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw === 'boolean') return raw;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  return undefined;
}

type ContactRow = { id: string; email: string | null; phone: string | null; nickname: string | null };
type MaybeContact = { email?: string | null; phone?: string | null; nickname?: string | null } | null | undefined;

/** 联系方式(手机号/邮箱)是否已经有了 —— 昵称不算,列表要的是能联系到人的东西。 */
function lacksContact(c: MaybeContact): boolean {
  return !c?.phone?.trim() && !c?.email?.trim();
}

/**
 * 用 user 域的权威数据补齐邀请记录里的联系方式。
 *
 * 背景:billing 的用户镜像表约 4 成用户 email/phone 都是空的(nprod 实测 91 个里 37 个),
 * 而 user 域有明文手机号。admin 列表要求「先显示手机号或邮箱」,所以这里补一刀。
 * 只对**确实缺**的用户发起补查,镜像里已有的直接用,避免无谓放大 user-api 压力。
 * 补查失败不影响主流程 —— 列表退化成原样(昵称/UID),不让它把整个页面打挂。
 */
export async function enrichRedemptionContacts(
  payload: unknown,
  fetchContacts: (ids: string[]) => Promise<unknown>,
  onError?: (err: unknown) => void,
): Promise<unknown> {
  const data = payload as { items?: Array<Record<string, unknown>> } | null;
  const items = data?.items;
  if (!Array.isArray(items) || items.length === 0) return payload;

  const missing = new Set<string>();
  for (const row of items) {
    if (lacksContact(row.inviter as MaybeContact) && typeof row.inviterUserId === 'string') {
      missing.add(row.inviterUserId);
    }
    if (lacksContact(row.invitee as MaybeContact) && typeof row.inviteeUserId === 'string') {
      missing.add(row.inviteeUserId);
    }
  }
  if (missing.size === 0) return payload;

  let rows: ContactRow[] = [];
  try {
    const res = (await fetchContacts([...missing])) as { items?: ContactRow[] } | null;
    rows = Array.isArray(res?.items) ? res.items : [];
  } catch (err) {
    onError?.(err);
    return payload;
  }
  const byId = new Map(rows.map((r) => [r.id, r]));

  for (const row of items) {
    for (const [idKey, contactKey] of [
      ['inviterUserId', 'inviter'],
      ['inviteeUserId', 'invitee'],
    ] as const) {
      const id = row[idKey];
      if (typeof id !== 'string') continue;
      const existing = row[contactKey] as MaybeContact;
      if (!lacksContact(existing)) continue;
      const found = byId.get(id);
      if (!found) continue;
      row[contactKey] = {
        ...(existing ?? {}),
        email: found.email ?? existing?.email ?? null,
        phone: found.phone ?? existing?.phone ?? null,
        nickname: existing?.nickname ?? found.nickname ?? null,
      };
    }
  }
  return payload;
}

@ApiTags('AdminV2 / Referrals')
@Controller('admin/v2/referrals')
@UseGuards(AdminJwtAuthGuard, AdminPermissionGuard)
export class ReferralsController {
  constructor(
    private readonly billing: BillingInternalClient,
    private readonly userClient: UserInternalClient,
  ) {}

  @RequireAdminPermission('admin.page.referrals.view')
  @Get('programs')
  async listPrograms(): Promise<ApiResponse<unknown>> {
    const data = await this.billing.listReferralPrograms();
    return { code: 0, message: 'ok', data };
  }

  @RequireAdminPermission('admin.page.referrals.manage')
  @Post('programs')
  async createProgram(@Body() body: ReferralProgramBody): Promise<ApiResponse<unknown>> {
    const data = await this.billing.createReferralProgram(body as Record<string, unknown>);
    return { code: 0, message: 'ok', data };
  }

  @RequireAdminPermission('admin.page.referrals.manage')
  @Put('programs/:id')
  async updateProgram(
    @Param('id') id: string,
    @Body() body: ReferralProgramBody,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.billing.updateReferralProgram(id, body as Record<string, unknown>);
    return { code: 0, message: 'ok', data };
  }

  @RequireAdminPermission('admin.page.referrals.manage')
  @Delete('programs/:id')
  async deleteProgram(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    const data = await this.billing.deleteReferralProgram(id);
    return { code: 0, message: 'ok', data };
  }

  @RequireAdminPermission('admin.page.referrals.manage')
  @Post('programs/:id/codes')
  async generateCode(
    @Param('id') id: string,
    @Body() body: ReferralCodeBody,
  ): Promise<ApiResponse<unknown>> {
    const inviterUser = (
      body?.inviterUser ??
      body?.inviterUserId ??
      body?.inviterEmail ??
      ''
    ).trim();
    if (!inviterUser) {
      throw new BadRequestException('推广方邮箱或用户 ID 必填');
    }
    const data = await this.billing.generateReferralCode(id, { inviterUser });
    return { code: 0, message: 'ok', data };
  }

  @RequireAdminPermission('admin.page.referrals.view')
  @Get('redemptions')
  async listRedemptions(
    @Query()
    query: {
      programId?: string;
      inviterUserId?: string;
      triggered?: string | boolean;
      page?: string;
      pageSize?: string;
    },
  ): Promise<ApiResponse<unknown>> {
    const data = await this.billing.listReferralRedemptions({
      programId: query.programId,
      inviterUserId: query.inviterUserId,
      triggered: parseBooleanQuery(query.triggered),
      page: query.page ? Number(query.page) : undefined,
      pageSize: query.pageSize ? Number(query.pageSize) : undefined,
    });
    const enriched = await enrichRedemptionContacts(
      data,
      (ids) => this.userClient.getUserContactsByIds(ids),
    );
    return { code: 0, message: 'ok', data: enriched };
  }

  @RequireAdminPermission('admin.page.referrals.view')
  @Get('leaderboard')
  async leaderboard(
    @Query() query: { programId?: string; days?: string },
  ): Promise<ApiResponse<unknown>> {
    const data = await this.billing.referralLeaderboard({
      programId: query.programId,
      days: query.days ? Number(query.days) : undefined,
    });
    return { code: 0, message: 'ok', data };
  }

  @RequireAdminPermission('admin.page.referrals.view')
  @Get('summary')
  async summary(
    @Query() query: { programId?: string },
  ): Promise<ApiResponse<unknown>> {
    const data = await this.billing.referralSummary({
      programId: query.programId,
    });
    return { code: 0, message: 'ok', data };
  }

  @RequireAdminPermission('admin.page.referrals.view')
  @Get('click-sources')
  async clickSources(
    @Query() query: { programId?: string },
  ): Promise<ApiResponse<unknown>> {
    const data = await this.billing.referralClickSources({
      programId: query.programId ?? '',
    });
    return { code: 0, message: 'ok', data };
  }

  @RequireAdminPermission('admin.page.referrals.view')
  @Get('codes')
  async codes(
    @Query() query: { programId?: string },
  ): Promise<ApiResponse<unknown>> {
    const data = await this.billing.referralCodes({
      programId: query.programId ?? '',
    });
    return { code: 0, message: 'ok', data };
  }
}
