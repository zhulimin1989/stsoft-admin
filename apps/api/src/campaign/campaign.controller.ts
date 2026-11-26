import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminJwtAuthGuard } from '../common/guards/admin-jwt-auth.guard';
import { AdminPermissionGuard } from '../common/guards/admin-permission.guard';
import { RequireAdminPermission } from '../common/decorators/admin-permission.decorator';
import { BillingInternalClient } from '../billing/billing-internal.client';
import { ApiResponse } from '@ruidong/shared';

type CampaignBillingPeriod =
  | 'monthly'
  | 'quarterly'
  | 'yearly'
  | 'both'
  | 'all';

interface CampaignPriceInput {
  currency: string;
  monthlyPrice: number;
  quarterlyPrice?: number;
  yearlyPrice: number;
}

interface CreateCampaignBody {
  productId?: string | null;
  planId: string;
  name: string;
  description?: string;
  scope: 'all' | 'new_users' | 'old_users';
  firstTimeOnly?: boolean;
  billingPeriod: CampaignBillingPeriod;
  startAt: Date | string;
  endAt: Date | string;
  maxUsesPerUser?: number;
  maxUsesTotal?: number;
  priority?: number;
  prices: CampaignPriceInput[];
}

interface UpdateCampaignBody extends Partial<CreateCampaignBody> {
  isActive?: boolean;
}

@ApiTags('Admin Campaigns')
@Controller('admin/campaigns')
@UseGuards(AdminJwtAuthGuard, AdminPermissionGuard)
export class CampaignController {
  constructor(private readonly billing: BillingInternalClient) {}

  @Get()
  @RequireAdminPermission('admin.page.campaigns.view')
  async list(
    @Query('planId') planId?: string,
    @Query('productId') productId?: string,
    @Query('isActive') isActive?: string,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.billing.listCampaigns({
      planId,
      productId,
      isActive: isActive === undefined ? undefined : isActive === 'true',
    });
    return { code: 0, message: 'ok', data };
  }

  @Get(':id')
  @RequireAdminPermission('admin.page.campaigns.view')
  async getOne(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    const data = await this.billing.getCampaign(id);
    return { code: 0, message: 'ok', data };
  }

  @Get(':id/stats')
  @RequireAdminPermission('admin.page.campaigns.view')
  async stats(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    const data = await this.billing.getCampaignStats(id);
    return { code: 0, message: 'ok', data };
  }

  @Post()
  @RequireAdminPermission('admin.page.campaigns.manage')
  async create(@Body() body: CreateCampaignBody): Promise<ApiResponse<unknown>> {
    const data = await this.billing.createCampaign(body as unknown as Record<string, unknown>);
    return { code: 0, message: 'ok', data };
  }

  @Put(':id')
  @RequireAdminPermission('admin.page.campaigns.manage')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateCampaignBody,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.billing.updateCampaign(id, body as unknown as Record<string, unknown>);
    return { code: 0, message: 'ok', data };
  }

  @Delete(':id')
  @RequireAdminPermission('admin.page.campaigns.manage')
  async disable(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    const data = await this.billing.disableCampaign(id);
    return { code: 0, message: 'ok', data };
  }
}
