import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { ApiResponse } from '@ruidong/shared';
import type { FastifyReply } from 'fastify';
import { RequireAdminPermission } from '../common/decorators/admin-permission.decorator';
import { AdminJwtAuthGuard } from '../common/guards/admin-jwt-auth.guard';
import { AdminPermissionGuard } from '../common/guards/admin-permission.guard';
import { BillingInternalClient } from './billing-internal.client';
import {
  EnterpriseBillsInternalClient,
  type EnterpriseBillAccountSummary,
} from './enterprise-bills-internal.client';
import { UserInternalClient } from '../user/user-internal.client';
import { AdminActivityLogService } from '../admin/admin-activity-log.service';
import { getAdminRequestContext } from '../common/request/admin-context';
import {
  ENTERPRISE_ACCOUNTS_CREDIT_MANAGE,
  ENTERPRISE_ACCOUNTS_MANAGE,
  ENTERPRISE_ACCOUNTS_VIEW,
} from './enterprise-account-admin-proxy.controller';

type BillingAccount = {
  id: string;
  verificationId?: string | null;
  ownerUserId?: string | null;
  ledgerBalanceAfterCents?: number | null;
  credit?: {
    limitCents?: number;
    usedCents?: number;
    remainingCents?: number;
    activeLimitCents?: number;
    accountBalanceCents?: number | null;
    accountAvailableBalanceCents?: number;
  } | null;
};

@Controller('admin/v2/enterprise-accounts')
@UseGuards(AdminJwtAuthGuard, AdminPermissionGuard)
export class EnterpriseAccountAdminV2Controller {
  constructor(
    private readonly billing: BillingInternalClient,
    private readonly bills: EnterpriseBillsInternalClient,
    private readonly user: UserInternalClient,
    private readonly activityLog: AdminActivityLogService,
  ) {}

  @RequireAdminPermission(ENTERPRISE_ACCOUNTS_VIEW)
  @Get()
  async list(
    @Query()
    query: {
      page?: string;
      pageSize?: string;
      status?: string;
      ownerUserId?: string;
      uscc?: string;
      search?: string;
    },
  ): Promise<ApiResponse<unknown>> {
    const search = query.search?.trim() || '';
    let ownerUserId = query.ownerUserId;
    let phoneNoMatch = false;
    if (!ownerUserId && looksLikePhone(search)) {
      const found = await this.findOwnerByPhone(search);
      if (found) {
        ownerUserId = found;
      } else {
        // 手机号格式但查无此用户 → 强制空结果，不落到全量列表。
        phoneNoMatch = true;
      }
    }
    const data = await this.billing.listEnterpriseAccounts({
      page: query.page ? parseInt(query.page, 10) : 1,
      pageSize: query.pageSize ? parseInt(query.pageSize, 10) : 10,
      ...(query.status ? { status: query.status } : {}),
      ...(ownerUserId ? { ownerUserId } : {}),
      ...(phoneNoMatch ? { ownerUserId: '__no_match__' } : {}),
      ...(query.uscc ? { uscc: query.uscc } : {}),
      ...(search && !looksLikePhone(search) ? { search } : {}),
    }) as { items: BillingAccount[] } & Record<string, unknown>;
    const items = Array.isArray(data.items) ? data.items : [];
    const [summaries, contacts] = await Promise.all([
      items.length > 0
        ? this.bills.summarizeEnterpriseBills(items.map((item) => item.id))
        : Promise.resolve({ items: [] as EnterpriseBillAccountSummary[] }),
      this.loadContacts(items),
    ]);
    const overlay = new Map((summaries.items ?? []).map((row) => [row.billingAccountId, row]));
    return {
      code: 0,
      message: 'ok',
      data: {
        ...data,
        items: items.map((item) => mergeAccount(item, overlay.get(item.id), contacts.get(item.ownerUserId ?? ''))),
      },
    };
  }

  @RequireAdminPermission(ENTERPRISE_ACCOUNTS_VIEW)
  @Get(':id/bills')
  async listBills(
    @Param('id') id: string,
    @Query('button_visible') buttonVisibleRaw?: string,
  ): Promise<ApiResponse<unknown>> {
    const buttonVisible = parseBillButtonVisible(buttonVisibleRaw);
    const data = await this.bills.listEnterpriseBills(id, canManage(), buttonVisible);
    return { code: 0, message: 'ok', data };
  }

  @RequireAdminPermission(ENTERPRISE_ACCOUNTS_MANAGE)
  @Post(':id/bills/:yearMonth/write-off')
  async writeOff(
    @Param('id') id: string,
    @Param('yearMonth') yearMonth: string,
    @Body() body: { amountCents?: number; note?: string | null; idempotencyKey?: string },
  ): Promise<ApiResponse<unknown>> {
    const amountCents = requirePositiveCents(body?.amountCents, '核销金额');
    const note = requireWriteOffNote(body?.note);
    const idempotencyKey = requireField(body?.idempotencyKey, 'idempotencyKey');
    const data = await this.bills.writeOffEnterpriseBill(id, yearMonth, {
      amountCents,
      note,
      idempotencyKey,
      canManage: canManage(),
    });
    await this.audit('enterprise_account.bill.write_off', id, { yearMonth, amountCents, note });
    return { code: 0, message: 'ok', data };
  }

  @RequireAdminPermission(ENTERPRISE_ACCOUNTS_MANAGE)
  @Post(':id/bills/:yearMonth/adjust')
  async adjust(
    @Param('id') id: string,
    @Param('yearMonth') yearMonth: string,
    @Body() body: {
      direction?: 'increase' | 'decrease';
      amountCents?: number;
      note?: string | null;
      idempotencyKey?: string;
    },
  ): Promise<ApiResponse<unknown>> {
    const direction = body?.direction;
    if (direction !== 'increase' && direction !== 'decrease') {
      throw new BadRequestException('direction 必须是 increase 或 decrease');
    }
    const amountCents = requirePositiveCents(body?.amountCents, '调整金额');
    const note = requireAdjustReason(body?.note);
    const idempotencyKey = requireField(body?.idempotencyKey, 'idempotencyKey');
    const data = await this.bills.adjustEnterpriseBill(id, yearMonth, {
      direction,
      amountCents,
      note,
      idempotencyKey,
      canManage: canManage(),
    });
    await this.audit('enterprise_account.bill.adjust', id, { yearMonth, direction, amountCents, note });
    return { code: 0, message: 'ok', data };
  }

  @RequireAdminPermission(ENTERPRISE_ACCOUNTS_MANAGE)
  @Post(':id/bills/:yearMonth/compensate-voucher')
  async compensateVoucher(
    @Param('id') id: string,
    @Param('yearMonth') yearMonth: string,
    @Body() body: {
      amountCents?: number;
      note?: string | null;
      productId?: string;
      tenantId?: string | null;
      idempotencyKey?: string;
    },
  ): Promise<ApiResponse<unknown>> {
    const amountCents = requirePositiveCents(body?.amountCents, '补偿金额');
    const note = requireField(body?.note, '补偿原因');
    const productId = requireField(body?.productId, 'productId');
    const idempotencyKey = requireField(body?.idempotencyKey, 'idempotencyKey');
    const data = await this.bills.compensateVoucherEnterpriseBill(id, yearMonth, {
      amountCents,
      note,
      productId,
      tenantId: body?.tenantId ?? null,
      idempotencyKey,
      canManage: canManage(),
    });
    await this.audit('enterprise_account.bill.compensate_voucher', id, {
      yearMonth, amountCents, note, productId,
    });
    return { code: 0, message: 'ok', data };
  }

  @RequireAdminPermission(ENTERPRISE_ACCOUNTS_MANAGE)
  @Post(':id/bills/:yearMonth/extend')
  async extend(
    @Param('id') id: string,
    @Param('yearMonth') yearMonth: string,
    @Body() body: { dueAt?: string; idempotencyKey?: string },
  ): Promise<ApiResponse<unknown>> {
    const dueAt = requireField(body?.dueAt, 'dueAt');
    const idempotencyKey = requireField(body?.idempotencyKey, 'idempotencyKey');
    const data = await this.bills.extendEnterpriseBill(id, yearMonth, {
      dueAt,
      idempotencyKey,
      canManage: canManage(),
    });
    if (!isIdempotentReplay(data)) {
      await this.audit('enterprise_account.bill.extend', id, { yearMonth, dueAt });
    }
    return { code: 0, message: 'ok', data };
  }

  @RequireAdminPermission(ENTERPRISE_ACCOUNTS_VIEW)
  @Get(':id/bills/:yearMonth/download')
  async download(
    @Param('id') id: string,
    @Param('yearMonth') yearMonth: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.bills.pipeEnterpriseBillDownload(id, yearMonth, reply);
  }

  @RequireAdminPermission(ENTERPRISE_ACCOUNTS_VIEW)
  @Get(':id/credit-events')
  async listCreditEvents(
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.billing.listEnterpriseAccountCreditEvents(id, {
      ...(limit ? { limit: parseInt(limit, 10) } : {}),
      ...(cursor ? { cursor } : {}),
    });
    return { code: 0, message: 'ok', data };
  }

  @RequireAdminPermission(ENTERPRISE_ACCOUNTS_VIEW)
  @Get(':id/credit')
  async getCredit(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    const data = await this.billing.getEnterpriseAccountCredit(id);
    return { code: 0, message: 'ok', data };
  }

  @RequireAdminPermission(ENTERPRISE_ACCOUNTS_CREDIT_MANAGE)
  @Put(':id/credit')
  async updateCredit(
    @Param('id') id: string,
    @Body()
    body: {
      limitCents?: number | null;
      status?: string | null;
      termsDays?: number | null;
      effectiveAt?: string | null;
      expiresAt?: string | null;
      reason?: string | null;
      note?: string | null;
    },
  ): Promise<ApiResponse<unknown>> {
    const operatorId = getAdminRequestContext()?.adminId ?? null;
    const reason = requireField(body?.reason, 'reason');
    const data = await this.billing.updateEnterpriseAccountCredit(id, {
      ...(body?.limitCents !== undefined ? { limitCents: body.limitCents } : {}),
      ...(body?.status !== undefined ? { status: body.status } : {}),
      ...(body?.termsDays !== undefined ? { termsDays: body.termsDays } : {}),
      ...(body?.effectiveAt !== undefined ? { effectiveAt: body.effectiveAt } : {}),
      ...(body?.expiresAt !== undefined ? { expiresAt: body.expiresAt } : {}),
      reason,
      ...(body?.note !== undefined ? { note: body.note } : {}),
      updatedBy: operatorId,
    });
    await this.audit('enterprise_account.credit.update', id, { reason, status: body?.status ?? null });
    return { code: 0, message: 'ok', data };
  }

  @RequireAdminPermission(ENTERPRISE_ACCOUNTS_MANAGE)
  @Post(':id/recharge')
  async recharge(
    @Param('id') id: string,
    @Body()
    body: {
      amountCents?: number;
      productId?: string | null;
      description?: string | null;
      idempotencyKey?: string | null;
    },
  ): Promise<ApiResponse<unknown>> {
    const amountCents = requirePositiveCents(body?.amountCents, 'amountCents');
    const productId = requireField(body?.productId, 'productId');
    const description = typeof body?.description === 'string' && body.description.trim()
      ? body.description.trim()
      : '企业账户管理员充值';
    const idempotencyKey = requireField(body?.idempotencyKey, 'idempotencyKey');
    const data = await this.billing.rechargeEnterpriseAccount(id, {
      amountCents,
      productId,
      description,
      idempotencyKey,
    });
    await this.audit('enterprise_account.balance.recharge', id, { amountCents, productId, description });
    return { code: 0, message: '充值成功', data };
  }

  @RequireAdminPermission(ENTERPRISE_ACCOUNTS_MANAGE)
  @Post(':id/vouchers')
  async issueVoucher(
    @Param('id') id: string,
    @Body()
    body: {
      tenantId?: string;
      userId?: string;
      productId?: string | null;
      amountCents?: number;
      reason?: string;
      expiresAt?: string | null;
      idempotencyKey?: string;
    },
  ): Promise<ApiResponse<unknown>> {
    const tenantId = requireField(body?.tenantId, 'tenantId');
    const userId = requireField(body?.userId, 'userId');
    const amountCents = requirePositiveCents(body?.amountCents, 'amountCents');
    const reason = requireField(body?.reason, 'reason');
    const idempotencyKey = requireField(body?.idempotencyKey, 'idempotencyKey');
    const data = await this.billing.issuePaygVoucher(tenantId, {
      userId,
      productId: body.productId ?? null,
      amountCents,
      reason,
      expiresAt: body?.expiresAt ?? null,
      idempotencyKey,
    });
    await this.audit('enterprise_account.voucher.issue', id, { tenantId, amountCents, reason });
    return { code: 0, message: 'ok', data };
  }

  @RequireAdminPermission(ENTERPRISE_ACCOUNTS_MANAGE)
  @Post(':id/attach-tenant')
  async attachTenant(
    @Param('id') id: string,
    @Body() body: { tenantId?: string },
  ): Promise<ApiResponse<unknown>> {
    const tenantId = requireField(body?.tenantId, 'tenantId');
    const data = await this.billing.attachEnterpriseTenant(id, { tenantId });
    await this.audit('enterprise_account.tenant.attach', id, { tenantId });
    return { code: 0, message: 'ok', data };
  }

  @RequireAdminPermission(ENTERPRISE_ACCOUNTS_VIEW)
  @Get(':id/tenants')
  async listTenants(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    const data = await this.billing.listEnterpriseAccountTenants(id);
    return { code: 0, message: 'ok', data };
  }

  @RequireAdminPermission(ENTERPRISE_ACCOUNTS_VIEW)
  @Get(':id/model-discounts')
  async listModelDiscounts(
    @Param('id') id: string,
    @Query('productId') productId?: string,
  ): Promise<ApiResponse<unknown>> {
    if (!productId) {
      throw new BadRequestException('productId 不能为空');
    }
    const data = await this.billing.listEnterpriseModelDiscounts(id, productId);
    return { code: 0, message: 'ok', data };
  }

  @RequireAdminPermission(ENTERPRISE_ACCOUNTS_VIEW)
  @Get(':id')
  async detail(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    const account = await this.billing.getEnterpriseAccount(id) as BillingAccount | null;
    if (!account) {
      throw new NotFoundException('企业账户不存在');
    }
    const [summaries, contact, ownerVerification, ownerMembers] = await Promise.all([
      this.bills.summarizeEnterpriseBills([id]),
      account.ownerUserId ? this.safeUser(account.ownerUserId) : Promise.resolve(null),
      account.ownerUserId ? this.safeVerification(account.ownerUserId, account.verificationId ?? undefined) : Promise.resolve(null),
      this.safeOwnerMembers(id),
    ]);
    const summary = summaries.items.find((row) => row.billingAccountId === id);
    return {
      code: 0,
      message: 'ok',
      data: {
        account: {
          ...mergeAccount(account, summary, contact),
          ownerMembers,
        },
        ownerVerification,
      },
    };
  }

  @RequireAdminPermission(ENTERPRISE_ACCOUNTS_MANAGE)
  @Put(':id/model-discounts')
  async upsertModelDiscounts(
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.billing.updateEnterpriseModelDiscounts(id, body as Record<string, unknown>);
    return { code: 0, message: 'ok', data };
  }

  @RequireAdminPermission(ENTERPRISE_ACCOUNTS_MANAGE)
  @Post()
  async create(@Body() body: unknown): Promise<ApiResponse<unknown>> {
    const data = await this.billing.createEnterpriseAccount(body as never);
    return { code: 0, message: 'ok', data };
  }

  private async loadContacts(items: BillingAccount[]): Promise<Map<string, Contact>> {
    const contacts = new Map<string, Contact>();
    const ownerIds = [...new Set(items.map((item) => item.ownerUserId).filter((id): id is string => Boolean(id)))];
    if (ownerIds.length === 0) {
      return contacts;
    }
    try {
      const raw = await this.user.getUserContactsByIds(ownerIds) as {
        items?: Array<{ id?: string; phone?: string | null; email?: string | null }>;
      };
      for (const row of raw.items ?? []) {
        if (typeof row?.id !== 'string' || row.id.length === 0) {
          continue;
        }
        contacts.set(row.id, {
          phone: row.phone ?? null,
          email: row.email ?? null,
        });
      }
    } catch {
      // 联系人补齐失败不阻断列表。
    }
    return contacts;
  }

  private async findOwnerByPhone(search: string): Promise<string | undefined> {
    try {
      const result = await this.user.searchUsers({ search, page: 1, pageSize: 20 }) as {
        items?: Array<{ id?: string; phone?: string | null }>;
      };
      const match = (result.items ?? []).find((row) => row.phone === search);
      return match?.id;
    } catch {
      return undefined;
    }
  }

  private async safeVerification(userId: string, verificationId?: string): Promise<Record<string, unknown> | null> {
    try {
      const raw = await this.user.getUserVerifications(userId);
      const items = Array.isArray(raw)
        ? raw
        : (raw as { items?: unknown[] } | null)?.items;
      const list = Array.isArray(items) ? items as Array<Record<string, unknown>> : [];
      const enterprise = list.filter((row) => row?.type === 'ENTERPRISE');
      if (verificationId) return enterprise.find(row => row?.id === verificationId) ?? null;
      return enterprise.find((row) => row?.status === 'VERIFIED') ?? enterprise[0] ?? null;
    } catch {
      return null;
    }
  }

  private async safeOwnerMembers(id: string): Promise<Array<{
    userId: string;
    role?: string | null;
    status?: string | null;
  }>> {
    try {
      const raw = await this.billing.listEnterpriseAccountOwnerMembers(id) as {
        items?: Array<{ userId?: string; role?: string | null; status?: string | null }>;
      } | Array<{ userId?: string; role?: string | null; status?: string | null }>;
      const items = Array.isArray(raw) ? raw : (raw?.items ?? []);
      return items
        .filter((row): row is { userId: string; role?: string | null; status?: string | null } =>
          typeof row?.userId === 'string' && row.userId.length > 0)
        .map((row) => ({
          userId: row.userId,
          role: row.role ?? null,
          status: row.status ?? null,
        }));
    } catch {
      // Owner 成员查询失败不阻断账务详情：区块展示「无」。
      return [];
    }
  }

  private async safeUser(id: string): Promise<Contact | null> {
    try {
      const user = await this.user.getUser(id) as Contact;
      return {
        phone: user?.phone ?? null,
        email: user?.email ?? null,
      };
    } catch {
      return null;
    }
  }

  private async audit(action: string, resourceId: string, detail: Record<string, unknown>): Promise<void> {
    const operatorId = getAdminRequestContext()?.adminId;
    if (!operatorId) {
      return;
    }
    await this.activityLog.log({
      adminMemberId: operatorId,
      action,
      resource: 'enterprise_account',
      resourceId,
      detail,
    });
  }
}

type Contact = { phone?: string | null; email?: string | null };

function canManage(): boolean {
  return (getAdminRequestContext()?.permissions ?? []).includes(ENTERPRISE_ACCOUNTS_MANAGE);
}

function mergeAccount(
  account: BillingAccount,
  summary?: EnterpriseBillAccountSummary,
  contact?: Contact | null,
) {
  // 已用信用 / 剩余 / 可用余额保持 V1 垫付占用（/credit），不用账单待付款覆盖。
  // 列表「余额」列：财务对账余额流水最新一条的变动后余额；无流水则空。
  const credit = overlayListLedgerBalance(account);
  return {
    ...account,
    ...(credit ? { credit } : {}),
    phone: contact?.phone ?? null,
    email: contact?.email ?? null,
    earliestDueAt: summary?.earliestDueAt ?? null,
    earliestDueProjected: Boolean(summary?.earliestDueProjected),
    dueWarning: Boolean(summary?.dueWarning),
    prepaid: summary?.prepaid ?? false,
  };
}

function overlayListLedgerBalance(account: BillingAccount) {
  if (!account.credit) return account.credit;
  if (!('ledgerBalanceAfterCents' in account)) return account.credit;
  return {
    ...account.credit,
    accountBalanceCents: account.ledgerBalanceAfterCents ?? null,
  };
}

function looksLikePhone(value: string): boolean {
  return /^\d{6,}$/.test(value);
}

function requireField(value: string | undefined | null, name: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) throw new BadRequestException(`${name} 不能为空`);
  return trimmed;
}

function isIdempotentReplay(data: unknown): boolean {
  return typeof data === 'object'
    && data !== null
    && (data as { replayed?: unknown }).replayed === true;
}

function requirePositiveCents(value: unknown, _name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new BadRequestException(`${_name}必须大于 0`);
  }
  return value;
}

function requireAdjustReason(value: string | undefined | null): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) throw new BadRequestException('调整原因必填');
  return trimmed;
}

function requireWriteOffNote(value: string | undefined | null): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) throw new BadRequestException('备注必填');
  if (trimmed.length > 100) throw new BadRequestException('备注不能超过 100 字');
  return trimmed;
}

/** 缺省 false；仅显式 true/1 为 true。 */
function parseBillButtonVisible(raw?: string): boolean {
  if (raw == null || raw.trim() === '') return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === 'true' || normalized === '1';
}
