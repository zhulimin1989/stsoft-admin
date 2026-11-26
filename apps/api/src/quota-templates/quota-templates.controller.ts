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
import { RequireAdminPermission } from '../common/decorators/admin-permission.decorator';
import { AdminJwtAuthGuard } from '../common/guards/admin-jwt-auth.guard';
import { AdminPermissionGuard } from '../common/guards/admin-permission.guard';

interface QuotaRule {
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

function parseInteger(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseBoolean(raw: string | boolean | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw === 'boolean') return raw;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  return undefined;
}

@ApiTags('AdminV2 / QuotaTemplates')
@Controller('admin/v2/quota-templates')
@UseGuards(AdminJwtAuthGuard, AdminPermissionGuard)
export class QuotaTemplatesController {
  constructor(private readonly billing: BillingInternalClient) {}

  @RequireAdminPermission('admin.page.coding_quota_templates.view')
  @Get()
  async list(
    @Query()
    query: {
      page?: string;
      pageSize?: string;
      search?: string;
      isActive?: string;
    },
  ): Promise<ApiResponse<unknown>> {
    const data = await this.billing.listQuotaTemplates({
      page: parseInteger(query.page, 1),
      pageSize: parseInteger(query.pageSize, 20),
      search: query.search?.trim() || undefined,
      isActive: parseBoolean(query.isActive),
    });
    return { code: 0, message: 'ok', data };
  }

  @RequireAdminPermission('admin.page.coding_quota_templates.manage')
  @Post()
  async create(
    @Body()
    body: {
      name?: string;
      description?: string;
      rules?: QuotaRule[] | string;
      isActive?: boolean;
    },
  ): Promise<ApiResponse<unknown>> {
    if (!body?.name) throw new BadRequestException('name 必填');
    if (body.rules === undefined) throw new BadRequestException('rules 必填');
    const data = await this.billing.createQuotaTemplate({
      name: body.name,
      description: body.description,
      rules: body.rules,
      isActive: body.isActive,
    });
    return { code: 0, message: '创建成功', data };
  }

  @RequireAdminPermission('admin.page.coding_quota_templates.view')
  @Get('plan/:planId/rules')
  async listPlanRules(@Param('planId') planId: string): Promise<ApiResponse<unknown>> {
    const data = await this.billing.listPlanQuotaRules(planId);
    return { code: 0, message: 'ok', data };
  }

  @RequireAdminPermission('admin.page.coding_quota_templates.manage')
  @Put('plan/:planId/rules')
  async replacePlanRules(
    @Param('planId') planId: string,
    @Body() body: { templateIds?: string[] },
  ): Promise<ApiResponse<unknown>> {
    const data = await this.billing.replacePlanQuotaRules(planId, {
      templateIds: body.templateIds ?? [],
    });
    return { code: 0, message: '保存成功', data };
  }

  @RequireAdminPermission('admin.page.coding_quota_templates.view')
  @Get(':id')
  async getOne(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    const data = await this.billing.getQuotaTemplate(id);
    return { code: 0, message: 'ok', data };
  }

  @RequireAdminPermission('admin.page.coding_quota_templates.manage')
  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      description?: string;
      rules?: QuotaRule[] | string;
      isActive?: boolean;
    },
  ): Promise<ApiResponse<unknown>> {
    const data = await this.billing.updateQuotaTemplate(id, body as Record<string, unknown>);
    return { code: 0, message: '更新成功', data };
  }

  @RequireAdminPermission('admin.page.coding_quota_templates.manage')
  @Delete(':id')
  async remove(@Param('id') id: string): Promise<ApiResponse<null>> {
    await this.billing.deleteQuotaTemplate(id);
    return { code: 0, message: '删除成功', data: null };
  }

  @RequireAdminPermission('admin.page.coding_quota_templates.manage')
  @Post(':id/clone')
  async clone(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    const data = await this.billing.cloneQuotaTemplate(id);
    return { code: 0, message: '已复制', data };
  }

  @RequireAdminPermission('admin.page.coding_quota_templates.view')
  @Get(':id/references')
  async references(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    const data = await this.billing.getQuotaTemplateReferences(id);
    return { code: 0, message: 'ok', data };
  }
}
