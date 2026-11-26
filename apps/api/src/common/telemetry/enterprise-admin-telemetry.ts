import { randomUUID } from 'crypto';
// No Nest/runtime imports: Sentry loads this before application instrumentation.
export const ADMIN_CREATIONS_PREFIX = '/api/admin/v2/enterprise-accounts/admin-creations';
export function isEnterpriseAdminUrl(url: string) {
  const path = new URL(url, 'http://admin.internal').pathname;
  return path === ADMIN_CREATIONS_PREFIX || path.startsWith(ADMIN_CREATIONS_PREFIX + '/');
}
export function enterpriseAdminTelemetryPath(url: string) {
  const path = new URL(url, 'http://admin.internal').pathname, suffix = path.slice(path.indexOf(ADMIN_CREATIONS_PREFIX) + ADMIN_CREATIONS_PREFIX.length);
  if (['', '/', '/capabilities', '/owner-lookup', '/check', '/resolve', '/upload-sessions', '/recovery-inspection'].includes(suffix)) return ADMIN_CREATIONS_PREFIX + suffix;
  if (/^\/upload-sessions\/[^/]+\/license$/.test(suffix)) return `${ADMIN_CREATIONS_PREFIX}/upload-sessions/:sessionId/license`;
  if (/^\/upload-sessions\/[^/]+\/license\/[^/]+\/file$/.test(suffix)) return `${ADMIN_CREATIONS_PREFIX}/upload-sessions/:sessionId/license/:uploadId/file`;
  if (/^\/[^/]+\/(retry|recover|recovery|history|license-file)$/.test(suffix)) return `${ADMIN_CREATIONS_PREFIX}/:requestId/${suffix.split('/')[2]}`;
  return `${ADMIN_CREATIONS_PREFIX}/:requestId`;
}
export const enterpriseAdminUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function enterpriseAdminOperationId(value: unknown) { return enterpriseAdminUuid(value) ? value : randomUUID(); }
