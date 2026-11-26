import type { CreatePlanInput } from '@ruidong/shared';
import type { CodingPlanFulfillmentMode } from './codingPlanFulfillment';

export interface ProductInfo {
  id: string;
  name: string;
  slug: string;
  billingMode?: string;
}

export interface ChannelModel {
  model: string;
  provider?: string;
}

export interface ModelAccessItem {
  id?: string;
  planId: string;
  modelName: string;
  isActive: boolean;
  dailyLimit?: number;
  creditMultiplier?: number;
}

export interface PlanModelAccessConfig {
  isActive: boolean;
  creditMultiplier: number;
}

export interface ModelRoutePolicyItem {
  id?: string;
  planId: string;
  routeKey: string;
  primaryModel?: string | null;
  fallbackModels?: string[] | string | null;
  isActive: boolean;
}

export interface PlanModelRoutePolicyConfig {
  primaryModel: string | null;
  fallbackModels: string[];
  isActive: boolean;
}

export interface PlanDetailState extends CreatePlanInput {
  id: string;
  name: string;
  description: string;
  productId: string | null;
  planType: string;
  billingPeriod: string;
  monthlyPrice: number;
  quarterlyPrice: number;
  yearlyPrice: number;
  trialDays: number;
  monthlyCredits: number;
  creditsRollover: boolean;
  rolloverMaxMonths: number;
  usageMultiplier: number;
  overageEnabled: boolean;
  rateLimitRpm: number;
  rateLimitTpm: number;
  maxContextWindow: number;
  memberLimit: number;
  minimumSeats: number;
  maxSellableQuantity: number | null;
  features: string[];
  dataTraining: string;
  supportTier: string;
  ssoEnabled: boolean;
  priorityAccess: boolean;
  isActive: boolean;
  isLegacy: boolean;
  salesLimit: number;
  sortOrder: number;
  badge: string | null;
  fulfillmentMode: CodingPlanFulfillmentMode;
  providerLineId: string | null;
  providerLineCode?: string | null;
  upstreamProductId: string | null;
  resaleRouteId?: string | null;
  resaleRoutePriority?: number | null;
  resaleRouteEnabled?: boolean;
  quotaTemplateIds: string[];
  modelAccessMap: Record<string, PlanModelAccessConfig>;
  modelRoutePoliciesMap: Record<string, PlanModelRoutePolicyConfig>;
  modelAccess?: ModelAccessItem[];
  modelRoutePolicies?: ModelRoutePolicyItem[];
  product?: unknown;
  createdAt?: string;
  updatedAt?: string;
}

export type PlanDetailChange = (plan: PlanDetailState) => void;

export interface PlanPriceRow {
  id?: string;
  planId: string;
  currency: string;
  monthlyPrice: number;
  quarterlyPrice: number;
  yearlyPrice: number;
  isActive: boolean;
}
