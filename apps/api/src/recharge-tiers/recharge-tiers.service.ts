import { Injectable } from '@nestjs/common';
import { BillingInternalClient } from '../billing/billing-internal.client';

type RechargeBonusType = 'FIXED' | 'PERCENT';

export interface CreateRechargeTierInput {
  productId: string;
  amountCents: number;
  bonusType: RechargeBonusType;
  bonusValue: number;
  badge?: string | null;
  sortOrder?: number;
  isActive?: boolean;
  startAt?: string | Date | null;
  endAt?: string | Date | null;
}

export interface UpdateRechargeTierInput {
  productId?: string;
  amountCents?: number;
  bonusType?: RechargeBonusType;
  bonusValue?: number;
  badge?: string | null;
  sortOrder?: number;
  isActive?: boolean;
  startAt?: string | Date | null;
  endAt?: string | Date | null;
}

export interface ListFilters {
  page: number;
  pageSize: number;
  productId?: string;
  isActive?: boolean;
}

export interface RechargeTierDTO {
  id: string;
  productId: string;
  amountCents: number;
  bonusType: RechargeBonusType;
  bonusValue: number;
  badge: string | null;
  sortOrder: number;
  isActive: boolean;
  startAt: Date | string | null;
  endAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  overlapWarning?: string;
}

export type RechargeTierListResult = {
  items: RechargeTierDTO[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type RechargeTierProductListResult = {
  items: Array<{
    id: string;
    name: string;
    slug: string;
    billingMode: string;
    isActive: boolean;
  }>;
};

@Injectable()
export class RechargeTiersService {
  constructor(private readonly billingClient: BillingInternalClient) {}

  async listPaygProducts(): Promise<RechargeTierProductListResult> {
    return this.billingClient.listRechargeTierProducts();
  }

  async list(filters: ListFilters): Promise<RechargeTierListResult> {
    return this.billingClient.listRechargeTiers(filters);
  }

  async getById(id: string): Promise<RechargeTierDTO> {
    return this.billingClient.getRechargeTier(id);
  }

  async create(input: CreateRechargeTierInput): Promise<RechargeTierDTO> {
    return this.billingClient.createRechargeTier(input);
  }

  async update(
    id: string,
    input: UpdateRechargeTierInput,
  ): Promise<RechargeTierDTO> {
    return this.billingClient.updateRechargeTier(id, input);
  }

  async softDelete(id: string): Promise<void> {
    await this.billingClient.deleteRechargeTier(id);
  }

  async clone(id: string): Promise<RechargeTierDTO> {
    return this.billingClient.cloneRechargeTier(id);
  }
}
