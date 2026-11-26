import { z } from 'zod';
import { normalizeMainlandPhone } from './utils/phone';

/** Versioned independently of the other shared exports in each repository. */
export const ENTERPRISE_ADMIN_CONTRACT_VERSION = 1 as const;
export const ENTERPRISE_ADMIN_PERMISSION = 'admin.page.enterprise_accounts.review';
export const ENTERPRISE_ADMIN_UPLOAD_TTL_SECONDS = 24 * 60 * 60;
export const ENTERPRISE_ADMIN_SOURCE = 'ADMIN_ASSISTED' as const;

const identifier = z.string().trim().min(1).max(64);
const phone = z.string().max(64).transform((value, context) => {
  const normalized = normalizeMainlandPhone(value);
  if (!normalized) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: '手机号格式不正确' });
    return z.NEVER;
  }
  return normalized;
});
const enterpriseName = z.string().trim().min(2, '企业名称至少2位').max(128, '企业名称过长');
const uscc = z.string().trim().regex(/^[0-9A-HJ-NP-RTUWXY]{18}$/, '统一社会信用代码格式不正确');

export const enterpriseAdminOwnerLookupSchema = z.object({ phone }).strict();
export const enterpriseAdminResolveSchema = z.object({
  idempotencyKey: z.string().uuid(),
}).strict();
export const enterpriseAdminEmptySchema = z.object({}).strict();
export const enterpriseAdminRecoveryScanSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  afterRequestId: z.string().uuid().optional(),
}).strict();
export const enterpriseAdminCreationSchema = z.object({
  enterpriseName,
  uscc,
  ownerUserId: identifier,
  ownerPhone: phone,
  uploadSessionId: identifier,
  licenseUploadId: identifier,
  idempotencyKey: z.string().uuid(),
}).strict();
export const enterpriseAdminCheckSchema = z.object({
  enterpriseName,
  uscc,
  ownerUserId: identifier.optional(),
  ownerPhone: phone.optional(),
}).strict().superRefine((input, context) => {
  if (Boolean(input.ownerUserId) !== Boolean(input.ownerPhone)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['ownerPhone'],
      message: '账号与手机号必须同时填写',
    });
  }
});

export const ENTERPRISE_ADMIN_PUBLIC_STATUSES = [
  'SUBMITTED', 'PROVISIONING', 'SUCCEEDED', 'FAILED_RETRYABLE', 'FAILED_MANUAL', 'VOIDING', 'VOIDED',
] as const;
export type EnterpriseAdminPublicStatus = typeof ENTERPRISE_ADMIN_PUBLIC_STATUSES[number];

export const enterpriseAdminListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(ENTERPRISE_ADMIN_PUBLIC_STATUSES).optional(),
  requestId: identifier.optional(),
  ownerUserId: identifier.optional(),
  uscc: uscc.optional(),
}).strict();

export const enterpriseAdminHistorySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  beforeId: z.string().uuid().optional(),
  beforeAt: z.string().datetime({ offset: true }).optional(),
  operationId: z.string().uuid().optional(),
}).strict().superRefine((value, context) => {
  if (Boolean(value.beforeId) !== Boolean(value.beforeAt)) context.addIssue({code:z.ZodIssueCode.custom,message:'历史游标必须成对提供'});
});
export type EnterpriseAdminHistoryInput = z.infer<typeof enterpriseAdminHistorySchema>;
export const ENTERPRISE_ADMIN_HISTORY_ACTIONS = [
  'ACCESS_REJECTED','LOOKUP_REJECTED','CHECK_REJECTED','UPLOAD_REJECTED','LICENSE_READ_REJECTED','HTTP_REJECTED',
  'UPLOAD_SESSION_CREATED','UPLOAD_RESERVED','UPLOAD_READY','UPLOAD_CONSUMED','CLEANUP_CLAIMED','CLEANUP_DELETED','CLEANUP_FAILED',
  'ACCEPTED','PROVISION_STATE_CHANGED','ADMISSION_REJECTED','RECORD_READ_REJECTED','RETRY_QUEUED',
  'RECOVERY_JOB_REPAIRED','RECOVERY_JOB_SETTLED','RETRY_REJECTED','RECOVERY_REJECTED','OUTBOX_CLAIMED','OUTBOX_REJECTED','UNKNOWN',
] as const;
export interface EnterpriseAdminHistoryEvent {
  id: string; action: typeof ENTERPRISE_ADMIN_HISTORY_ACTIONS[number]; createdAt: string;
  operatorType: 'ADMIN'|'SYSTEM'|'UNKNOWN'; operatorId: string|null; correlationId: string|null; errorCode: string|null;
  provisioningStatus: string|null; jobStatus: string|null; attempts: number|null;
}
export interface EnterpriseAdminHistory {
  items: EnterpriseAdminHistoryEvent[]; hasMore: boolean;
  nextCursor: {id:string;createdAt:string}|null; scope: 'REQUEST_AND_ORIGINAL_KEY';
}

export const EnterpriseAdminError = {
  DISABLED: 'ENTERPRISE_ADMIN_DISABLED',
  INVALID_INPUT: 'ENTERPRISE_ADMIN_INVALID_INPUT',
  USER_NOT_FOUND: 'ENTERPRISE_ADMIN_USER_NOT_FOUND',
  USER_INACTIVE: 'ENTERPRISE_ADMIN_USER_INACTIVE',
  PHONE_CHANGED: 'ENTERPRISE_ADMIN_PHONE_CHANGED',
  PHONE_AMBIGUOUS: 'ENTERPRISE_ADMIN_PHONE_AMBIGUOUS',
  OWNER_CONFLICT: 'ENTERPRISE_ADMIN_OWNER_CONFLICT',
  APPLICATION_CONFLICT: 'ENTERPRISE_ADMIN_APPLICATION_CONFLICT',
  USCC_CONFLICT: 'ENTERPRISE_ADMIN_USCC_CONFLICT',
  BILLING_UNAVAILABLE: 'ENTERPRISE_ADMIN_BILLING_UNAVAILABLE',
  RESOURCE_INCOMPLETE: 'ENTERPRISE_ADMIN_RESOURCE_INCOMPLETE',
  UPLOAD_INVALID: 'ENTERPRISE_ADMIN_UPLOAD_INVALID',
  UPLOAD_UNAVAILABLE: 'ENTERPRISE_ADMIN_UPLOAD_UNAVAILABLE',
  AUDIT_UNAVAILABLE: 'ENTERPRISE_ADMIN_AUDIT_UNAVAILABLE',
  UPLOAD_EXPIRED: 'ENTERPRISE_ADMIN_UPLOAD_EXPIRED',
  UPLOAD_USED: 'ENTERPRISE_ADMIN_UPLOAD_USED',
  IDEMPOTENCY_CONFLICT: 'ENTERPRISE_ADMIN_IDEMPOTENCY_CONFLICT',
  NOT_RETRYABLE: 'ENTERPRISE_ADMIN_NOT_RETRYABLE',
  STATE_CONFLICT: 'ENTERPRISE_ADMIN_STATE_CONFLICT',
  NOT_FOUND: 'ENTERPRISE_ADMIN_NOT_FOUND',
} as const;
export type EnterpriseAdminErrorCode = typeof EnterpriseAdminError[keyof typeof EnterpriseAdminError];
export type EnterpriseAdminCreationInput = z.infer<typeof enterpriseAdminCreationSchema>;
export type EnterpriseAdminCheckInput = z.infer<typeof enterpriseAdminCheckSchema>;
export type EnterpriseAdminListInput = z.infer<typeof enterpriseAdminListSchema>;
export type EnterpriseAdminRecoveryScanInput = z.infer<typeof enterpriseAdminRecoveryScanSchema>;
export interface EnterpriseAdminRecoveryDecision {
  kind: 'NONE' | 'RETRY' | 'QUEUED' | 'PROCESSING' | 'TAKEOVER' | 'REPAIR_MISSING_JOB' | 'SETTLE_ACTIVE' | 'MANUAL' | 'UNKNOWN';
  reason: string;
  message: string;
  action: 'NONE' | 'RETRY_ORIGINAL' | 'WAIT_FOR_WORKER' | 'RECOVER_ORIGINAL' | 'USE_EXISTING_MANAGE' | 'CHECK_ORIGINAL_RESOURCES' | 'WAIT_FOR_DEPENDENCY';
}
export interface EnterpriseAdminRecoveryReport {
  requestId: string; verificationId: string; applicationId: string; ownerUserId: string; currentOwnerUserId: string | null;
  tenantId: string | null; billingAccountId: string | null; observedAt: string;
  decision: EnterpriseAdminRecoveryDecision;
}

export interface EnterpriseAdminCapabilities {
  enabled: boolean;
  supportedPlane: 'domestic';
  licenseMaxBytes: number;
  uploadTtlSeconds: number;
}
export interface EnterpriseAdminOwnerLookup {
  found: boolean;
  owner: { userId: string; nickname: string; phoneMasked: string | null } | null;
  eligible: boolean;
  reasonCode: EnterpriseAdminErrorCode | null;
}
export interface EnterpriseAdminUploadSession {
  id: string;
  expiresAt: string;
}
export interface EnterpriseAdminLicenseUpload {
  id: string;
  sessionId: string;
  contentType: string;
  size: number;
  sha256: string;
  expiresAt: string;
}
export interface EnterpriseAdminCreationRecord {
  requestId: string;
  applicationId: string;
  verificationId: string;
  source: 'ADMIN_ASSISTED';
  verificationMethod: 'ADMIN_OFFLINE';
  paymentMode: 'ADMIN_WAIVED';
  enterpriseName: string;
  uscc: string;
  ownerUserId: string;
  ownerPhoneMasked: string;
  createdByAdminId: string;
  createdAt: string;
  publicStatus: EnterpriseAdminPublicStatus;
  provisioningStatus: string | null;
  tenantId: string | null;
  billingAccountId: string | null;
  canRetry: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  recovery?: EnterpriseAdminRecoveryDecision;
}
