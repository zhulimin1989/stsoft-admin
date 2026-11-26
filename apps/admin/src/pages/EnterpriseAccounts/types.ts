export interface ProductOption {
  id: string;
  name: string;
  billingMode?: string | null;
  isActive?: boolean | null;
}

export type EnterpriseAccountPageMode = 'billing' | 'review';

export interface CreateEnterpriseAccountFormValues {
  userId: string;
  verificationId?: string;
  tenantId?: string;
}

export interface AttachTenantFormValues {
  tenantId: string;
}

export interface RechargeEnterpriseAccountFormValues {
  productId: string;
  amount: number;
  description: string;
}

export interface CreditConfigFormValues {
  limitAmount: number;
  status: 'ACTIVE' | 'DISABLED' | 'SUSPENDED';
  termsDays?: number | null;
  expiresAt?: string | null;
  reason: string;
  note?: string | null;
}

export interface RejectReviewFormValues {
  rejectCategory: 'payment_proof' | 'enterprise_info';
  rejectReason: string;
  note?: string;
}
