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

interface CreateDiscountCodeBody {
  code: string;
  name: string;
  description?: string;
  discountType: 'percent_off' | 'amount_off';
  discountValue: number;
  currency?: string;
  duration?: 'once' | 'repeating' | 'forever';
  durationMonths?: number;
  planIds?: string[];
  firstTimeOnly?: boolean;
  scope?: 'all' | 'new_users' | 'old_users';
  maxUses?: number;
  maxUsesPerUser?: number;
  startAt?: Date | string | null;
  endAt?: Date | string | null;
}

interface UpdateDiscountCodeBody extends Partial<CreateDiscountCodeBody> {
  isActive?: boolean;
}

@ApiTags('Admin Discount Codes')
@Controller('admin/discount-codes')
@UseGuards(AdminJwtAuthGuard, AdminPermissionGuard)
export class DiscountCodeController {
  constructor(private readonly billing: BillingInternalClient) {}

  @Get()
  @RequireAdminPermission('admin.page.discount_codes.view')
  async list(@Query('isActive') isActive?: string): Promise<ApiResponse<unknown>> {
    const data = await this.billing.listDiscountCodes({
      isActive: isActive === undefined ? undefined : isActive === 'true',
    });
    return { code: 0, message: 'ok', data };
  }

  @Get(':id')
  @RequireAdminPermission('admin.page.discount_codes.view')
  async getOne(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    const data = await this.billing.getDiscountCode(id);
    return { code: 0, message: 'ok', data };
  }

  @Get(':id/stats')
  @RequireAdminPermission('admin.page.discount_codes.view')
  async stats(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    const data = await this.billing.getDiscountCodeStats(id);
    return { code: 0, message: 'ok', data };
  }

  @Post()
  @RequireAdminPermission('admin.page.discount_codes.manage')
  async create(@Body() body: CreateDiscountCodeBody): Promise<ApiResponse<unknown>> {
    const data = await this.billing.createDiscountCode(body as unknown as Record<string, unknown>);
    return { code: 0, message: 'ok', data };
  }

  @Put(':id')
  @RequireAdminPermission('admin.page.discount_codes.manage')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateDiscountCodeBody,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.billing.updateDiscountCode(id, body as unknown as Record<string, unknown>);
    return { code: 0, message: 'ok', data };
  }

  @Delete(':id')
  @RequireAdminPermission('admin.page.discount_codes.manage')
  async disable(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    const data = await this.billing.disableDiscountCode(id);
    return { code: 0, message: 'ok', data };
  }
}
