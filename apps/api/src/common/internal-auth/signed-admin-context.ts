import { createHmac } from 'crypto';
import type { AdminRequestContext } from '../request/admin-context';

export type SignedAdminContextPayload = {
  version: 1;
  adminId: string;
  presetRole?: string;
  permissions: string[];
  requestId?: string;
  issuedAt: string;
};

function compactPermissions(permissions: string[] | undefined): string[] {
  return Array.from(new Set((permissions ?? []).map((p) => p.trim()).filter(Boolean)));
}

function signPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function signedAdminContextHeaders(
  context: AdminRequestContext,
  secret: string,
  issuedAt: Date = new Date(),
): Record<string, string> {
  const payload: SignedAdminContextPayload = {
    version: 1,
    adminId: context.adminId,
    ...(context.presetRole ? { presetRole: context.presetRole } : {}),
    permissions: compactPermissions(context.permissions),
    ...(context.requestId ? { requestId: context.requestId } : {}),
    issuedAt: issuedAt.toISOString(),
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return {
    'x-admin-context': encoded,
    'x-admin-context-signature': signPayload(encoded, secret),
  };
}
